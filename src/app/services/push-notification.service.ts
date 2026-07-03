import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { PushNotifications, Token } from '@capacitor/push-notifications';
import { environment } from '../../environments/environment';
import { NotificationNavigationService } from './notification-navigation.service';
import { UserPhoto } from './photo.service';

/**
 * Notifications PinPhoto (barre du haut Android) :
 * - Paiement / souvenir / position → LocalNotifications (immédiat ou ~5 s).
 * - En plus : push FCM serveur si app fermée.
 */

const PAYMENT_CHANNEL = 'pinphoto_payments';
const APP_CHANNEL = 'pinphoto_default';
const APP_NAME = 'PinPhoto';
const ACTION_OPEN_PHOTO = 'open_photo';
const ACTION_PAYMENT = 'payment_confirmed';
const MEMORY_NOTIFIED_KEY = 'photo_memory_notified';

export type PaymentProduct = 'premium' | 'download';

export function paymentNotificationCopy(product: PaymentProduct): { title: string; body: string } {
  if (product === 'premium') {
    return {
      title: `${APP_NAME} — Paiement confirmé`,
      body: 'Récap : Éditeur Premium activé (5,00 €). Photos géolocalisées sur la carte.',
    };
  }
  return {
    title: `${APP_NAME} — Paiement confirmé`,
    body: 'Récap : Téléchargement photo (1,00 €). Export enregistré sur votre appareil.',
  };
}

export function photoMemoryNotificationCopy(address: string): { title: string; body: string } {
  const place = address.trim() || 'cet endroit';
  return {
    title: `${APP_NAME} — Souvenir`,
    body: `Vous vous souvenez de cette photo à ${place} ? Appuyez pour la revoir.`,
  };
}

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private initialized = false;
  private memoryNotified = new Set<string>();
  private lastLocationNotified?: string;
  private nav = inject(NotificationNavigationService);

  async init(): Promise<void> {
    if (!Capacitor.isNativePlatform() || this.initialized) {
      return;
    }

    this.initialized = true;
    await this.loadMemoryNotified();
    await this.setupAndroidChannels();
    await LocalNotifications.requestPermissions();

    await PushNotifications.addListener('registration', async (token: Token) => {
      await Preferences.set({ key: 'fcm_token', value: token.value });
      await this.sendTokenToBackend(token.value);
    });

    await PushNotifications.addListener('registrationError', (err) => {
      console.error('Push registration error:', err.error);
    });

    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      const data = notification.data ?? {};
      // Paiement + souvenir : vraie push FCM seulement (app fermée / arrière-plan).
      if (data['channel'] === 'payment' || data['action'] === ACTION_OPEN_PHOTO) {
        return;
      }

      const { title, body, extra } = this.resolveNotificationContent(notification);
      if (body === 'Appuyez pour ouvrir PinPhoto.') {
        return;
      }
      void this.showSystemNotification(title, body, APP_CHANNEL, extra);
    });

    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      this.handleDeepLink(action.notification.data);
    });

    await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      this.handleDeepLink(event.notification.extra);
    });

    const permStatus = await this.ensurePushPermission();
    if (permStatus.receive === 'granted') {
      await PushNotifications.register();
    }
  }

  /** Paiement : notif barre tout de suite + push FCM serveur (app fermée). */
  sendPaymentPush(product: PaymentProduct): void {
    void this.showPaymentNotification(product);
    void this.requestPaymentPush(product);
  }

  /** Photo géolocalisée : notif barre + push FCM serveur. */
  sendPhotoMemoryPush(photo: UserPhoto): void {
    if (!photo.address?.trim() || this.memoryNotified.has(photo.filepath)) {
      return;
    }

    this.memoryNotified.add(photo.filepath);
    void this.persistMemoryNotified();
    void this.showPhotoMemoryNotification(photo);
    void this.requestPhotoMemoryPush(photo);
  }

  /** Carte : « Vous êtes actuellement à … » dans la barre de notifications. */
  notifyCurrentLocation(address: string): void {
    const place = address?.trim();
    if (!place || place === this.lastLocationNotified) {
      return;
    }

    this.lastLocationNotified = place;
    void this.showSystemNotification(
      `${APP_NAME} — Position`,
      `Vous êtes actuellement à ${place}.`,
      APP_CHANNEL,
    );
  }

  private async showPaymentNotification(product: PaymentProduct): Promise<void> {
    const { title, body } = paymentNotificationCopy(product);
    await this.showSystemNotification(title, body, PAYMENT_CHANNEL, {
      action: ACTION_PAYMENT,
    });
  }

  private async showPhotoMemoryNotification(photo: UserPhoto): Promise<void> {
    const { title, body } = photoMemoryNotificationCopy(photo.address!);
    const scheduleAt = new Date(Date.now() + 5000);
    await this.showSystemNotification(
      title,
      body,
      APP_CHANNEL,
      { action: ACTION_OPEN_PHOTO, filepath: photo.filepath },
      scheduleAt,
    );
  }

  private async requestPaymentPush(product: PaymentProduct): Promise<void> {
    const { value: token } = await Preferences.get({ key: 'fcm_token' });
    if (!token) {
      console.warn('Pas de token FCM — push paiement impossible');
      return;
    }

    try {
      const response = await fetch(`${environment.stripe.backendUrl}/notify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, product, delaySeconds: 15 }),
      });

      if (!response.ok) {
        console.error('notify-payment:', await response.text());
      }
    } catch (error) {
      console.error('Erreur push paiement:', error);
    }
  }

  private async requestPhotoMemoryPush(photo: UserPhoto): Promise<void> {
    const { value: token } = await Preferences.get({ key: 'fcm_token' });
    if (!token) {
      console.warn('Pas de token FCM — push souvenir serveur ignorée');
      return;
    }

    try {
      const response = await fetch(`${environment.stripe.backendUrl}/notify-photo-memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          filepath: photo.filepath,
          address: photo.address,
          delaySeconds: 15,
        }),
      });

      if (!response.ok) {
        console.error('notify-photo-memory:', await response.text());
      }
    } catch (error) {
      console.error('Erreur push souvenir:', error);
    }
  }

  private handleDeepLink(data?: Record<string, unknown>): void {
    if (data?.['action'] === ACTION_PAYMENT) {
      void this.nav.navigateToTab('tab3');
      return;
    }

    if (data?.['action'] !== ACTION_OPEN_PHOTO) {
      return;
    }

    const filepath = String(data['filepath'] ?? '');
    if (filepath) {
      void this.nav.navigateToPhoto(filepath);
    }
  }

  private resolveNotificationContent(notification: {
    title?: string;
    body?: string;
    data?: Record<string, string>;
  }): { title: string; body: string; extra: Record<string, string> } {
    const data = notification.data ?? {};
    const title = notification.title?.trim() || data['title']?.trim() || APP_NAME;
    const body =
      notification.body?.trim() ||
      data['body']?.trim() ||
      'Appuyez pour ouvrir PinPhoto.';

    const extra: Record<string, string> = {};
    if (data['action']) {
      extra['action'] = data['action'];
    }
    if (data['filepath']) {
      extra['filepath'] = data['filepath'];
    }

    return { title, body, extra };
  }

  private async showSystemNotification(
    title: string,
    body: string,
    channelId: string,
    extra: Record<string, string> = {},
    scheduleAt?: Date,
  ): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      return;
    }

    if (!body.trim()) {
      return;
    }

    await LocalNotifications.schedule({
      notifications: [
        {
          id: (Date.now() % 200000) + 1,
          title: title.trim() || APP_NAME,
          body: body.trim(),
          channelId,
          smallIcon: 'ic_stat_pinphoto',
          largeIcon: 'res://mipmap/ic_launcher',
          sound: 'default',
          extra,
          schedule: scheduleAt ? { at: scheduleAt } : undefined,
        },
      ],
    });
  }

  private async setupAndroidChannels(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android') {
      return;
    }

    const channels = [
      { id: PAYMENT_CHANNEL, name: 'Paiements PinPhoto', importance: 5 as const },
      { id: APP_CHANNEL, name: 'PinPhoto', importance: 4 as const },
    ];

    for (const ch of channels) {
      await PushNotifications.createChannel({
        id: ch.id,
        name: ch.name,
        importance: ch.importance,
        visibility: 1,
        vibration: true,
      });
      await LocalNotifications.createChannel({
        id: ch.id,
        name: ch.name,
        importance: ch.importance,
        visibility: 1,
      });
    }
  }

  private async loadMemoryNotified(): Promise<void> {
    const { value } = await Preferences.get({ key: MEMORY_NOTIFIED_KEY });
    if (!value) {
      return;
    }

    try {
      for (const filepath of JSON.parse(value) as string[]) {
        this.memoryNotified.add(filepath);
      }
    } catch {
      // Ignorer JSON invalide.
    }
  }

  private async persistMemoryNotified(): Promise<void> {
    await Preferences.set({
      key: MEMORY_NOTIFIED_KEY,
      value: JSON.stringify([...this.memoryNotified]),
    });
  }

  private async ensurePushPermission() {
    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }
    return status;
  }

  private async sendTokenToBackend(token: string, attempt = 0): Promise<void> {
    try {
      const response = await fetch(`${environment.stripe.backendUrl}/register-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!response.ok && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        await this.sendTokenToBackend(token, attempt + 1);
      }
    } catch {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        await this.sendTokenToBackend(token, attempt + 1);
      }
    }
  }
}
