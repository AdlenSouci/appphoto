import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { ViewDidEnter } from '@ionic/angular';
import {
  AlertController,
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  cameraOutline,
  checkmarkCircle,
  closeCircle,
  colorWandOutline,
  imagesOutline,
  informationCircleOutline,
  locationOutline,
  lockClosedOutline,
  shieldCheckmarkOutline,
  sparklesOutline,
} from 'ionicons/icons';
import { GeolocationService } from '../services/geolocation.service';
import { PaymentService } from '../services/payment.service';
import { PermissionsService } from '../services/permissions.service';
import { PhotoService } from '../services/photo.service';
import { PremiumService } from '../services/premium.service';

@Component({
  selector: 'app-tab3',
  templateUrl: 'tab3.page.html',
  styleUrls: ['tab3.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonIcon,
    IonButton,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonSpinner,
  ],
})
export class Tab3Page implements ViewDidEnter {
  premium = inject(PremiumService);
  payment = inject(PaymentService);
  permissions = inject(PermissionsService);
  private photoService = inject(PhotoService);
  private geoService = inject(GeolocationService);
  private alertController = inject(AlertController);
  private cdr = inject(ChangeDetectorRef);

  photoCount = 0;
  geoCount = 0;
  likedCount = 0;
  isPurchasing = false;
  readonly appVersion = '1.0.0';

  constructor() {
    addIcons({
      sparklesOutline,
      colorWandOutline,
      lockClosedOutline,
      checkmarkCircle,
      closeCircle,
      imagesOutline,
      locationOutline,
      cameraOutline,
      informationCircleOutline,
      shieldCheckmarkOutline,
    });
  }

  async ionViewDidEnter() {
    await this.premium.refresh();
    await this.permissions.refresh();
    await this.photoService.ensureLoaded();
    this.refreshStats();
    this.cdr.detectChanges();
  }

  get cameraGranted(): boolean {
    return this.permissions.isCameraGranted();
  }

  get locationGranted(): boolean {
    return this.permissions.canShowMap;
  }

  get cameraStatusLabel(): string {
    return this.statusLabel(this.permissions.cameraState);
  }

  get locationStatusLabel(): string {
    return this.statusLabel(this.permissions.locationState);
  }

  private statusLabel(state: string): string {
    if (state === 'granted' || state === 'limited') {
      return 'Autorisée';
    }
    if (state === 'denied') {
      return 'Refusée';
    }
    return 'Non demandée';
  }

  async askCameraPermission() {
    const granted = await this.permissions.requestCameraPermission();
    await this.permissions.refresh();
    this.cdr.detectChanges();

    if (!granted) {
      await this.geoService.showToast(
        'Caméra refusée. Activez-la dans Réglages Android > Applications > PinPhoto.',
        'long',
      );
    }
  }

  async askLocationPermission() {
    const granted = await this.permissions.requestLocationPermission();
    await this.permissions.refresh();
    this.cdr.detectChanges();

    if (!granted) {
      await this.geoService.showToast(
        'Localisation refusée. Activez-la dans Réglages Android > Applications > PinPhoto.',
        'long',
      );
    }
  }

  private refreshStats() {
    const photos = this.photoService.photos;
    this.photoCount = photos.length;
    this.geoCount = this.photoService.getPhotosWithLocation().length;
    this.likedCount = photos.filter((photo) => photo.liked).length;
  }

  async unlockPremium() {
    if (this.premium.isPremium || this.isPurchasing) {
      return;
    }

    this.isPurchasing = true;
    this.cdr.detectChanges();

    const success = await this.payment.purchaseEditorPremium();
    if (success) {
      await this.premium.refresh();
      await this.geoService.showToast('Éditeur Premium débloqué', 'long');
    }

    this.isPurchasing = false;
    this.cdr.detectChanges();
  }

  async cancelPremium() {
    const alert = await this.alertController.create({
      header: 'Résilier l\'abonnement ?',
      message: 'Vous perdrez l\'accès aux filtres et au dessin. Vous pourrez le reprendre à tout moment.',
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        {
          text: 'Résilier',
          role: 'destructive',
          handler: () => {
            void this.confirmCancel();
          },
        },
      ],
    });

    await alert.present();
  }

  private async confirmCancel() {
    await this.premium.cancel();
    await this.geoService.showToast('Abonnement résilié');
    this.cdr.detectChanges();
  }
}
