import { Injectable, inject } from '@angular/core';
import { Geolocation, PositionOptions } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';
import { PermissionsService } from './permissions.service';
import { ToastService } from './toast.service';

export interface UserPosition {
  lat: number;
  lng: number;
  address?: string;
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
}

interface NominatimResponse {
  display_name?: string;
  address?: NominatimAddress;
}

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  public position?: UserPosition;

  private toastService = inject(ToastService);
  private permissions = inject(PermissionsService);
  private readonly POSITION_STORAGE = 'position';

  public async getCurrentPosition(): Promise<UserPosition> {
    await this.permissions.refresh();

    if (!this.permissions.canShowMap) {
      const granted = await this.permissions.requestLocationPermission();
      if (!granted) {
        throw new Error('Location permission denied');
      }
    }

    return this.readCurrentPosition();
  }

  /** Prépare le GPS en arrière-plan (1er fix plus rapide à la prise de photo). */
  async warmUpGps(): Promise<void> {
    await this.permissions.refresh();
    if (!this.permissions.canShowMap) {
      return;
    }

    try {
      const position = await this.readQuickPosition();
      this.position = position;
    } catch {
      // Pas bloquant.
    }
  }

  /**
   * Position pour une photo : rapide, sans bloquer l'ouverture caméra.
   * Utilise la position en cache si disponible, sinon GPS court (max ~5 s).
   */
  public async capturePositionForPhoto(): Promise<UserPosition | undefined> {
    if (!this.permissions.canShowMap) {
      return undefined;
    }

    if (this.position?.lat != null && this.position.lng != null) {
      return {
        lat: this.position.lat,
        lng: this.position.lng,
        address: this.position.address,
      };
    }

    const saved = await this.loadSaved();
    if (saved?.lat != null && saved.lng != null) {
      this.position = saved;
      return saved;
    }

    try {
      const position = await this.readQuickPosition();
      this.position = position;
      return position;
    } catch {
      return undefined;
    }
  }

  /** GPS rapide pour ne pas bloquer la prise de photo. */
  private async readQuickPosition(): Promise<UserPosition> {
    const strategies: PositionOptions[] = [
      { enableHighAccuracy: true, timeout: 4000, maximumAge: 30000 },
      { enableHighAccuracy: false, timeout: 3000, maximumAge: 120000 },
    ];

    let lastError: unknown;
    for (const options of strategies) {
      try {
        const result = await Geolocation.getCurrentPosition(options);
        return {
          lat: result.coords.latitude,
          lng: result.coords.longitude,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error('Position unavailable');
  }

  /**
   * GPS au moment de la prise de photo (repli après la capture).
   */
  public async getPositionForPhoto(attempts = 1): Promise<UserPosition | undefined> {
    if (!this.permissions.canShowMap) {
      return undefined;
    }

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const position = await this.readQuickPosition();
        position.address = await this.resolveAddress(position.lat, position.lng);
        this.position = position;
        return position;
      } catch {
        if (attempt < attempts - 1) {
          await this.delay(800);
        }
      }
    }

    return this.position;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** GPS silencieux : uniquement si la permission est déjà accordée. */
  public async tryGetPositionIfGranted(): Promise<UserPosition | undefined> {
    await this.permissions.refresh();

    if (!this.permissions.canShowMap) {
      return undefined;
    }

    try {
      const position = await this.readCurrentPosition();
      position.address = await this.resolveAddress(position.lat, position.lng);
      return position;
    } catch {
      return undefined;
    }
  }

  private async readCurrentPosition(): Promise<UserPosition> {
    const strategies: PositionOptions[] = [
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 },
    ];

    let lastError: unknown;
    for (const options of strategies) {
      try {
        const result = await Geolocation.getCurrentPosition(options);
        this.position = {
          lat: result.coords.latitude,
          lng: result.coords.longitude,
        };

        await this.savePosition(this.position);
        return this.position;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error('Position unavailable');
  }

  public async resolveAddress(lat: number, lng: number): Promise<string> {
    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse` +
        `?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'fr',
          'User-Agent': 'app_mobile/1.0',
        },
      });

      if (!response.ok) {
        throw new Error('Reverse geocoding failed');
      }

      const data = (await response.json()) as NominatimResponse;
      return (
        this.formatStreetAddress(data) ??
        data.display_name ??
        `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      );
    } catch {
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  }

  private formatStreetAddress(data: NominatimResponse): string | undefined {
    const address = data.address;
    if (!address) {
      return undefined;
    }

    const street = address.road ?? address.pedestrian ?? address.footway;
    const streetLine = [address.house_number, street].filter(Boolean).join(' ');
    const city =
      address.city ?? address.town ?? address.village ?? address.municipality;
    const parts = [streetLine, address.postcode, city].filter(Boolean);

    return parts.length > 0 ? parts.join(', ') : undefined;
  }

  public async savePosition(position: UserPosition): Promise<void> {
    this.position = position;
    await Preferences.set({
      key: this.POSITION_STORAGE,
      value: JSON.stringify(position),
    });
  }

  /** Convertit une adresse texte en coordonnées (pour réparer les photos existantes). */
  public async forwardGeocode(address: string): Promise<UserPosition | undefined> {
    const query = address.trim();
    if (!query) {
      return undefined;
    }

    try {
      const url =
        `https://nominatim.openstreetmap.org/search` +
        `?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'fr',
          'User-Agent': 'app_mobile/1.0',
        },
      });

      if (!response.ok) {
        return undefined;
      }

      const results = (await response.json()) as Array<{ lat: string; lon: string }>;
      if (!results.length) {
        return undefined;
      }

      const lat = Number.parseFloat(results[0].lat);
      const lng = Number.parseFloat(results[0].lon);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return undefined;
      }

      return { lat, lng, address: query };
    } catch {
      return undefined;
    }
  }

  distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  public async loadSaved(): Promise<UserPosition | undefined> {
    const { value } = await Preferences.get({ key: this.POSITION_STORAGE });
    if (!value) {
      return undefined;
    }

    this.position = JSON.parse(value) as UserPosition;
    return this.position;
  }

  public async showToast(
    message: string,
    duration: 'short' | 'long' = 'short',
    variant: 'success' | 'info' | 'error' = 'info',
  ) {
    await this.toastService.show(message, duration, variant);
  }
}
