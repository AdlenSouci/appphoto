import { Injectable, inject } from '@angular/core';
import { PaymentSheetEventsEnum, Stripe } from '@capacitor-community/stripe';
import { environment } from '../../environments/environment';
import { PremiumService } from './premium.service';
import { PhotoService } from './photo.service';
import { PurchaseProduct, PurchaseService } from './purchase.service';
import { PushNotificationService } from './push-notification.service';
import { ToastService } from './toast.service';

interface PaymentSheetResponse {
  paymentIntent: string;
  ephemeralKey: string;
  customer: string;
  publishableKey: string;
  product?: PurchaseProduct;
}

export interface PurchaseRequest {
  product: PurchaseProduct;
  filepath?: string;
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private premium = inject(PremiumService);
  private purchases = inject(PurchaseService);
  private photoService = inject(PhotoService);
  private toast = inject(ToastService);
  private push = inject(PushNotificationService);

  lastError?: string;

  private readonly fallbackPublishableKey = environment.stripe.publishableKey;
  private workingBackendUrl?: string;

  private get backendCandidates(): string[] {
    const configured = environment.stripe.backendUrl.replace(/\/$/, '');
    return [...new Set([this.workingBackendUrl, configured, 'http://127.0.0.1:4000', 'http://localhost:4000'].filter(Boolean) as string[])];
  }

  async checkBackend(): Promise<boolean> {
    try {
      await this.requestPaymentSheet({ product: 'premium' });
      return true;
    } catch {
      return false;
    }
  }

  async purchaseEditorPremium(): Promise<boolean> {
    return this.purchase({ product: 'premium' });
  }

  async purchasePhotoDownload(filepath: string): Promise<'exported' | 'paid' | false> {
    await this.purchases.refresh();

    if (this.purchases.isDownloadUnlocked(filepath)) {
      await this.photoService.exportPhoto(filepath);
      return 'exported';
    }

    const success = await this.purchase({ product: 'download', filepath });
    if (success) {
      await this.purchases.unlockDownload(filepath);
      await this.photoService.exportPhoto(filepath);
      return 'paid';
    }

    return false;
  }

  async purchase(request: PurchaseRequest): Promise<boolean> {
    this.lastError = undefined;

    try {
      const sheet = await this.requestPaymentSheet(request);

      await Stripe.initialize({
        publishableKey: sheet.publishableKey || this.fallbackPublishableKey,
      });

      await Stripe.createPaymentSheet({
        paymentIntentClientSecret: sheet.paymentIntent,
        customerEphemeralKeySecret: sheet.ephemeralKey,
        customerId: sheet.customer,
        merchantDisplayName: 'PinPhoto',
        enableGooglePay: true,
        GooglePayIsTesting: true,
        countryCode: 'FR',
        currencyCode: 'EUR',
      });

      const { paymentResult } = await Stripe.presentPaymentSheet();

      if (paymentResult === PaymentSheetEventsEnum.Completed) {
        if (request.product === 'premium') {
          await this.premium.unlock();
        }
        this.push.sendPaymentPush(request.product);
        await this.toast.show(
          'Paiement OK. Fermez l\'app : push de confirmation dans ~15 secondes.',
          'long',
        );
        return true;
      }

      if (paymentResult === PaymentSheetEventsEnum.Canceled) {
        await this.toast.show('Paiement annulé.');
      }

      if (paymentResult === PaymentSheetEventsEnum.Failed) {
        this.lastError = 'Le paiement Stripe a échoué.';
        await this.toast.show(this.lastError, 'long');
      }

      return false;
    } catch (error) {
      this.lastError = this.formatError(error);
      console.error('Stripe payment error', error);
      await this.toast.show(this.lastError, 'long');
      return false;
    }
  }

  private async requestPaymentSheet(
    request: PurchaseRequest,
  ): Promise<PaymentSheetResponse> {
    let lastError: unknown;

    for (const baseUrl of this.backendCandidates) {
      try {
        const response = await fetch(`${baseUrl}/payment-sheet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Erreur serveur ${response.status}: ${body || 'réponse vide'}`);
        }

        this.workingBackendUrl = baseUrl;
        return (await response.json()) as PaymentSheetResponse;
      } catch (error) {
        lastError = error;
      }
    }

    throw this.buildConnectionError(lastError);
  }

  private buildConnectionError(lastError: unknown): Error {
    if (lastError instanceof Error && lastError.message.startsWith('Erreur serveur')) {
      return new Error('Paiement indisponible pour le moment. Réessayez plus tard.');
    }

    return new Error('Paiement indisponible pour le moment. Réessayez plus tard.');
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return 'Erreur inconnue lors du paiement.';
  }
}
