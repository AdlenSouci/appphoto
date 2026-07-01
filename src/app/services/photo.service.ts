import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Subject } from 'rxjs';
import { Camera, MediaResult } from '@capacitor/camera';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import { GeolocationService } from './geolocation.service';
import { PermissionsService } from './permissions.service';
import { PushNotificationService } from './push-notification.service';

export type GalleryFilter = 'all' | 'liked' | 'unliked';

export const GALLERY_SKELETON_THRESHOLD = 1;

export interface UserPhoto {
  filepath: string;
  webviewPath: string;
  liked?: boolean;
  lat?: number;
  lng?: number;
  address?: string;
  capturedAt?: string;
  /** Vrai pendant la récupération de la position (non persisté). */
  locating?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PhotoService {
  public photos: UserPhoto[] = [];
  /** Émis quand une photo reçoit (ou perd) sa localisation. */
  readonly locationUpdated$ = new Subject<string>();

  private PHOTO_STORAGE = 'photos';
  private REPAIR_FLAG = 'photos_location_repair_v1';
  private loadPromise?: Promise<void>;
  private permissions = inject(PermissionsService);
  private geoService = inject(GeolocationService);
  private pushService = inject(PushNotificationService);

  public getFilteredPhotos(filter: GalleryFilter): UserPhoto[] {
    if (filter === 'liked') {
      return this.photos.filter((photo) => photo.liked);
    }

    if (filter === 'unliked') {
      return this.photos.filter((photo) => !photo.liked);
    }

    return this.photos;
  }

  public getPhotosWithLocation(): UserPhoto[] {
    return this.photos.filter(
      (photo) => photo.lat != null && photo.lng != null,
    );
  }

  public getPhotosWithoutLocationCount(): number {
    return this.photos.filter(
      (photo) => photo.lat == null || photo.lng == null,
    ).length;
  }

  public async exportPhoto(filepath: string): Promise<string> {
    const file = await Filesystem.readFile({
      path: filepath,
      directory: Directory.Data,
    });

    const exportPath = `exports/${filepath}`;
    await Filesystem.writeFile({
      path: exportPath,
      data: file.data,
      directory: Directory.Documents,
      recursive: true,
    });

    return exportPath;
  }

  public getCaptureDate(photo: UserPhoto): Date {
    if (photo.capturedAt) {
      return new Date(photo.capturedAt);
    }

    const timestamp = Number.parseInt(photo.filepath.split('.')[0], 10);
    return Number.isNaN(timestamp) ? new Date() : new Date(timestamp);
  }

  public getPhotoByFilepath(filepath: string): UserPhoto | undefined {
    return this.photos.find((photo) => photo.filepath === filepath);
  }

  public async takePhoto(): Promise<boolean> {
    await this.permissions.refresh();

    if (!this.permissions.canTakePhoto) {
      return false;
    }

    if (!this.permissions.isCameraGranted()) {
      const granted = await this.permissions.requestCameraPermission();
      if (!granted) {
        return false;
      }
    }

    if (!this.permissions.canShowMap) {
      await this.permissions.requestLocationPermission();
      await this.permissions.refresh();
    }

    // GPS en parallèle — la caméra s'ouvre IMMÉDIATEMENT (ne pas await ici).
    const locationTask = this.permissions.canShowMap
      ? this.geoService.capturePositionForPhoto()
      : undefined;

    const result = await Camera.takePhoto({ quality: 80 });

    const savedPhoto = await this.savePhoto(result);
    savedPhoto.locating = !!locationTask;

    this.photos.unshift(savedPhoto);
    void this.persistPhotos();

    if (locationTask) {
      void this.finishPhotoLocation(savedPhoto, locationTask);
    }

    return true;
  }

  private async finishPhotoLocation(
    photo: UserPhoto,
    locationTask: Promise<{ lat: number; lng: number; address?: string } | undefined>,
  ): Promise<void> {
    let location = await locationTask;

    if (!location && this.permissions.canShowMap) {
      location = await this.geoService.getPositionForPhoto(1);
    }

    if (location && photo.lat == null && photo.lng == null) {
      photo.lat = location.lat;
      photo.lng = location.lng;
      photo.address =
        location.address ??
        (await this.geoService.resolveAddress(location.lat, location.lng));
      await this.persistPhotos();
    }

    photo.locating = false;
    this.locationUpdated$.next(photo.filepath);

    if (photo.lat != null && photo.lng != null && photo.address?.trim()) {
      void this.pushService.sendPhotoMemoryPush(photo);
    }
  }

  public async toggleLike(filepath: string): Promise<void> {
    const photo = this.photos.find((item) => item.filepath === filepath);
    if (!photo) {
      return;
    }

    photo.liked = !photo.liked;
    await this.persistPhotos();

    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Pas de retour haptique sur le web.
    }
  }

  public async deletePhoto(filepath: string): Promise<void> {
    try {
      await Filesystem.deleteFile({
        path: filepath,
        directory: Directory.Data,
      });
    } catch {
      // Fichier déjà absent.
    }

    this.photos = this.photos.filter((photo) => photo.filepath !== filepath);
    await this.persistPhotos();
  }

  public async updatePhoto(filepath: string, dataUrl: string): Promise<void> {
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

    await Filesystem.writeFile({
      path: filepath,
      data: base64,
      directory: Directory.Data,
    });

    const photo = this.photos.find((item) => item.filepath === filepath);
    if (photo) {
      photo.webviewPath = dataUrl.startsWith('data:')
        ? dataUrl
        : `data:image/jpeg;base64,${base64}`;
    }

    await this.persistPhotos();
  }

  private async savePhoto(
    cameraPhoto: MediaResult,
    location?: { lat: number; lng: number; address?: string },
  ): Promise<UserPhoto> {
    const fileName = `${Date.now()}.jpeg`;
    const written = await this.writeCameraFile(cameraPhoto, fileName);

    const photo: UserPhoto = {
      filepath: fileName,
      webviewPath: (await this.resolveWebPath(fileName)) ?? written,
      liked: false,
      capturedAt: new Date().toISOString(),
    };

    if (location) {
      photo.lat = location.lat;
      photo.lng = location.lng;
      photo.address = location.address;
    }

    return photo;
  }

  private async writeCameraFile(
    cameraPhoto: MediaResult,
    fileName: string,
  ): Promise<string> {
    const base64Data = await this.readAsBase64(cameraPhoto);
    await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Data,
    });
    return base64Data;
  }

  private async readAsBase64(cameraPhoto: MediaResult): Promise<string> {
    const response = await fetch(cameraPhoto.webPath!);
    const blob = await response.blob();
    return (await this.convertBlobToBase64(blob)) as string;
  }

  private convertBlobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });

  public async ensureLoaded(): Promise<void> {
    await this.loadSaved();
  }

  public async loadSaved(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.readPhotosFromStorage();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = undefined;
    }
  }

  private async readPhotosFromStorage(): Promise<void> {
    const { value } = await Preferences.get({ key: this.PHOTO_STORAGE });
    const stored = (value ? JSON.parse(value) : []) as UserPhoto[];

    const loaded = (
      await Promise.all(
        stored.map(async (photo) => {
          const webviewPath = await this.resolveWebPath(photo.filepath);
          if (!webviewPath) {
            return undefined;
          }

          if (photo.lat != null) {
            photo.lat = Number(photo.lat);
          }
          if (photo.lng != null) {
            photo.lng = Number(photo.lng);
          }

          photo.webviewPath = webviewPath;
          return photo;
        }),
      )
    ).filter((photo): photo is UserPhoto => photo != null);

    this.photos = loaded;
    void this.repairStoredLocations(loaded);
  }

  /**
   * Répare les photos existantes sans les supprimer :
   * si l'adresse enregistrée (ex. Aix) ne correspond pas aux coordonnées
   * (ex. Châteaurenard), on recalcule la position depuis l'adresse.
   */
  private async repairStoredLocations(photos: UserPhoto[]): Promise<void> {
    const { value: repairDone } = await Preferences.get({ key: this.REPAIR_FLAG });
    if (repairDone === 'done') {
      return;
    }

    let changed = false;

    for (const photo of photos) {
      if (!photo.address?.trim()) {
        continue;
      }

      const fromAddress = await this.geoService.forwardGeocode(photo.address);
      if (!fromAddress) {
        await this.delay(1100);
        continue;
      }

      const needsRepair =
        photo.lat == null ||
        photo.lng == null ||
        this.geoService.distanceMeters(
          photo.lat,
          photo.lng,
          fromAddress.lat,
          fromAddress.lng,
        ) > 1500;

      if (needsRepair) {
        photo.lat = fromAddress.lat;
        photo.lng = fromAddress.lng;
        changed = true;
      }

      await this.delay(1100);
    }

    if (changed) {
      await this.persistPhotos();
      this.locationUpdated$.next('repair');
    }

    await Preferences.set({ key: this.REPAIR_FLAG, value: 'done' });
  }

  /** Chemin d'affichage rapide (fichier local, pas de base64 en mémoire). */
  private async resolveWebPath(filepath: string): Promise<string | undefined> {
    try {
      if (Capacitor.isNativePlatform()) {
        const { uri } = await Filesystem.getUri({
          path: filepath,
          directory: Directory.Data,
        });
        return Capacitor.convertFileSrc(uri);
      }

      return await this.readPhotoDataUrl(filepath);
    } catch {
      return undefined;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async readPhotoDataUrl(filepath: string): Promise<string | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await Filesystem.readFile({
          path: filepath,
          directory: Directory.Data,
        });
        return `data:image/jpeg;base64,${file.data}`;
      } catch {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    return undefined;
  }

  public async getSavedCount(): Promise<number> {
    const { value } = await Preferences.get({ key: this.PHOTO_STORAGE });
    if (!value) {
      return 0;
    }

    return (JSON.parse(value) as UserPhoto[]).length;
  }

  private async persistPhotos(): Promise<void> {
    const toStore = this.photos.map(
      ({ filepath, liked, lat, lng, address, capturedAt }) => ({
      filepath,
      liked: !!liked,
      lat,
      lng,
      address,
      capturedAt,
    }),
    );

    await Preferences.set({
      key: this.PHOTO_STORAGE,
      value: JSON.stringify(toStore),
    });
  }
}
