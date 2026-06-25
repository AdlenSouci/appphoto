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
  private POSITION_STORAGE = 'position';

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

  public async loadSaved(): Promise<UserPosition | undefined> {
    const { value } = await Preferences.get({ key: this.POSITION_STORAGE });
    if (!value) {
      return undefined;
    }

    this.position = JSON.parse(value) as UserPosition;
    return this.position;
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

  public async showToast(message: string, duration: 'short' | 'long' = 'short') {
    await this.toastService.show(message, duration);
  }
}
