import { Injectable, inject } from '@angular/core';
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

    const toast = await this.toastController.create({
      message,
      duration: duration === 'long' ? 2000 : 1200,
      position: 'top',
      icon: this.iconFor(variant),
      cssClass: ['app-toast', `app-toast-${variant}`],
      swipeGesture: 'vertical',
    });

    this.current = toast;
    await toast.present();
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
