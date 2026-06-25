import { Injectable, inject } from '@angular/core';
import { Camera, MediaResult } from '@capacitor/camera';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import { GeolocationService } from './geolocation.service';
import { PermissionsService } from './permissions.service';

export type GalleryFilter = 'all' | 'liked' | 'unliked';

export const GALLERY_SKELETON_THRESHOLD = 8;

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
  private PHOTO_STORAGE = 'photos';
  private loadPromise?: Promise<void>;
  private permissions = inject(PermissionsService);
  private geoService = inject(GeolocationService);

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

    const result = await Camera.takePhoto({ quality: 100 });
    const savedPhoto = await this.savePhoto(result);

    // La photo apparaît tout de suite, on ne bloque pas sur le GPS.
    // On marque "locating" pour afficher un loader le temps de géolocaliser.
    savedPhoto.locating = true;
    this.photos.unshift(savedPhoto);
    await this.persistPhotos();

    // Position + adresse ajoutées en arrière-plan dès qu'elles sont prêtes.
    void this.attachLocation(savedPhoto.filepath);

    return true;
  }

  /** Récupère la position/adresse sans bloquer l'affichage de la photo. */
  private async attachLocation(filepath: string): Promise<void> {
    const photo = this.photos.find((item) => item.filepath === filepath);
    if (!photo) {
      return;
    }

    // Si la photo a DÉJÀ une position, on ne fait RIEN (sinon on écrase l'ancienne !).
    if (photo.lat != null && photo.lng != null) {
      photo.locating = false;
      return;
    }

    try {
      const location = await this.geoService.tryGetPositionIfGranted();
      if (location) {
        photo.lat = location.lat;
        photo.lng = location.lng;
        photo.address = location.address;
        await this.persistPhotos();
      }
    } catch {
      // Pas de position disponible : la photo reste sans adresse.
    } finally {
      photo.locating = false;
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
    const base64Data = await this.readAsBase64(cameraPhoto);

    const fileName = `${Date.now()}.jpeg`;
    await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Data,
    });

    const photo: UserPhoto = {
      filepath: fileName,
      webviewPath: base64Data,
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

    const loaded: UserPhoto[] = [];
    for (const photo of stored) {
      const webviewPath = await this.readPhotoDataUrl(photo.filepath);
      if (webviewPath) {
        photo.webviewPath = webviewPath;
        loaded.push(photo);
      }
    }

    this.photos = loaded;
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
