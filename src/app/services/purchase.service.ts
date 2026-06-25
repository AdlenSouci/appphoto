import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

export type PurchaseProduct = 'premium' | 'download';

export interface ShopProduct {
  id: PurchaseProduct;
  title: string;
  description: string;
  priceLabel: string;
  amountCents: number;
}

export const SHOP_PRODUCTS: ShopProduct[] = [
  {
    id: 'premium',
    title: 'Éditeur Premium',
    description: 'Filtres photo et mode dessin illimités.',
    priceLabel: '5,00 €',
    amountCents: 500,
  },
  {
    id: 'download',
    title: 'Télécharger une photo',
    description: 'Export HD d\'une image vers vos Documents.',
    priceLabel: '1,00 €',
    amountCents: 100,
  },
];

@Injectable({ providedIn: 'root' })
export class PurchaseService {
  private readonly DOWNLOADS_KEY = 'purchased_downloads';
  private downloadedFilepaths = new Set<string>();

  async refresh(): Promise<void> {
    const { value } = await Preferences.get({ key: this.DOWNLOADS_KEY });
    const stored = value ? (JSON.parse(value) as string[]) : [];
    this.downloadedFilepaths = new Set(stored);
  }

  isDownloadUnlocked(filepath: string): boolean {
    return this.downloadedFilepaths.has(filepath);
  }

  async unlockDownload(filepath: string): Promise<void> {
    this.downloadedFilepaths.add(filepath);
    await Preferences.set({
      key: this.DOWNLOADS_KEY,
      value: JSON.stringify([...this.downloadedFilepaths]),
    });
  }
}
