import { Injectable } from '@angular/core';
import { App } from '@capacitor/app';
import { Camera, CameraPermissionState } from '@capacitor/camera';
import { Capacitor, PermissionState } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

@Injectable({ providedIn: 'root' })
export class PermissionsService {
  canTakePhoto = false;
  canViewGallery = false;
  canShowMap = false;
  isReady = false;

  cameraState: CameraPermissionState = 'prompt';
  photosState: CameraPermissionState = 'prompt';
  locationState: PermissionState = 'prompt';

  constructor() {
    if (Capacitor.isNativePlatform()) {
      App.addListener('resume', () => {
        void this.refresh();
      });
    }
  }

  async refresh(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      this.applyWebDefaults();
      return;
    }

    try {
      const [cameraStatus, geoStatus] = await Promise.all([
        Camera.checkPermissions(),
        Geolocation.checkPermissions(),
      ]);

      this.cameraState = cameraStatus.camera;
      this.photosState = cameraStatus.photos;
      this.locationState = geoStatus.location;

      this.canTakePhoto = this.cameraState !== 'denied';
      // Galerie interne (Filesystem) — pas la galerie système du téléphone.
      this.canViewGallery = true;
      this.canShowMap =
        this.isGranted(geoStatus.location) || this.isGranted(geoStatus.coarseLocation);
    } catch {
      this.canTakePhoto = this.cameraState !== 'denied';
      this.canViewGallery = true;
      this.canShowMap = false;
    } finally {
      this.isReady = true;
    }
  }

  needsLocationRequest(): boolean {
    return (
      this.locationState === 'prompt' ||
      this.locationState === 'prompt-with-rationale'
    );
  }

  isLocationDenied(): boolean {
    return this.locationState === 'denied';
  }

  isCameraGranted(): boolean {
    return this.isGranted(this.cameraState);
  }

  async requestCameraPermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return true;
    }

    const status = await Camera.requestPermissions({ permissions: ['camera'] });
    this.cameraState = status.camera;
    this.canTakePhoto = this.cameraState !== 'denied';
    return this.isGranted(this.cameraState);
  }

  async requestPhotosPermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return true;
    }

    const status = await Camera.requestPermissions({ permissions: ['photos'] });
    this.photosState = status.photos;
    return this.isGranted(this.photosState);
  }

  async requestLocationPermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return true;
    }

    const status = await Geolocation.requestPermissions();
    this.locationState = status.location;
    this.canShowMap =
      this.isGranted(status.location) || this.isGranted(status.coarseLocation);
    return this.canShowMap;
  }

  private applyWebDefaults(): void {
    this.cameraState = 'granted';
    this.photosState = 'granted';
    this.locationState = 'granted';
    this.canTakePhoto = true;
    this.canViewGallery = true;
    this.canShowMap = true;
    this.isReady = true;
  }

  private isGranted(state: PermissionState | CameraPermissionState): boolean {
    return state === 'granted' || state === 'limited';
  }
}
