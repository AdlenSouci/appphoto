import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Toast } from '@capacitor/toast';
import { ToastController } from '@ionic/angular/standalone';
import { checkmarkCircle, informationCircle, warningOutline } from 'ionicons/icons';
import { addIcons } from 'ionicons';

type ToastVariant = 'success' | 'info' | 'error';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private toastController = inject(ToastController);
  private lastMessage = '';
  private lastAt = 0;
  private current?: HTMLIonToastElement;

  constructor() {
    addIcons({ checkmarkCircle, informationCircle, warningOutline });
  }

  async show(
    message: string,
    duration: 'short' | 'long' = 'short',
    variant: ToastVariant = 'info',
  ): Promise<void> {
    const now = Date.now();
    if (message === this.lastMessage && now - this.lastAt < 2500) {
      return;
    }

    this.lastMessage = message;
    this.lastAt = now;

    await this.current?.dismiss().catch(() => undefined);

    if (Capacitor.isNativePlatform()) {
      await Toast.show({
        text: message,
        duration: duration === 'long' ? 'long' : 'short',
        position: 'top',
      });
      return;
    }

    const toast = await this.toastController.create({
      message,
      duration: duration === 'long' ? 3500 : 2000,
      position: 'top',
      icon: this.iconFor(variant),
      cssClass: ['app-toast', `app-toast-${variant}`],
      mode: 'ios',
      animated: true,
    });

    this.current = toast;
    await toast.present();

    toast.onDidDismiss().then(() => {
      if (this.current === toast) {
        this.current = undefined;
      }
    });
  }

  async success(message: string, duration: 'short' | 'long' = 'short'): Promise<void> {
    await this.show(message, duration, 'success');
  }

  async error(message: string, duration: 'short' | 'long' = 'long'): Promise<void> {
    await this.show(message, duration, 'error');
  }

  private iconFor(variant: ToastVariant): string {
    if (variant === 'success') {
      return 'checkmark-circle';
    }
    if (variant === 'error') {
      return 'warning-outline';
    }
    return 'information-circle';
  }
}
