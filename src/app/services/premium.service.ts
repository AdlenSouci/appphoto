import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

@Injectable({ providedIn: 'root' })
export class PremiumService {
  private readonly STORAGE_KEY = 'premium_editor';
  private isPremiumUnlocked = false;

  async refresh(): Promise<void> {
    const { value } = await Preferences.get({ key: this.STORAGE_KEY });
    this.isPremiumUnlocked = value === 'true';
  }

  get isPremium(): boolean {
    return this.isPremiumUnlocked;
  }

  async unlock(): Promise<void> {
    await Preferences.set({ key: this.STORAGE_KEY, value: 'true' });
    this.isPremiumUnlocked = true;
  }

  async cancel(): Promise<void> {
    await Preferences.remove({ key: this.STORAGE_KEY });
    this.isPremiumUnlocked = false;
  }
}
