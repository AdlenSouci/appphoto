import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AlertController } from '@ionic/angular/standalone';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonImg,
  IonModal,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmarkCircle,
  closeOutline,
  downloadOutline,
  heart,
  heartOutline,
  locationOutline,
  trashOutline,
} from 'ionicons/icons';
import { PaymentService } from '../../../services/payment.service';
import { PhotoService, UserPhoto } from '../../../services/photo.service';
import { PurchaseService } from '../../../services/purchase.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-photo-detail-modal',
  templateUrl: './photo-detail-modal.component.html',
  styleUrls: ['./photo-detail-modal.component.scss'],
  imports: [
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonImg,
    IonSpinner,
    DatePipe,
  ],
})
export class PhotoDetailModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() photo?: UserPhoto;
  @Input() loading = false;

  @Output() closed = new EventEmitter<void>();
  @Output() liked = new EventEmitter<string>();
  @Output() deleted = new EventEmitter<string>();

  photoService = inject(PhotoService);
  purchases = inject(PurchaseService);
  private payment = inject(PaymentService);
  private alertController = inject(AlertController);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  isDownloading = false;
  downloadUnlocked = false;

  constructor() {
    addIcons({
      checkmarkCircle,
      closeOutline,
      downloadOutline,
      heart,
      heartOutline,
      trashOutline,
      locationOutline,
    });
  }

  get captureDate(): Date | null {
    if (!this.photo) {
      return null;
    }

    return this.photoService.getCaptureDate(this.photo);
  }

  async onModalDidPresent(): Promise<void> {
    await this.syncDownloadState();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['photo'] || changes['isOpen']?.currentValue) {
      void this.syncDownloadState();
    }
  }

  private async syncDownloadState(): Promise<void> {
    await this.purchases.refresh();
    this.downloadUnlocked = this.photo
      ? this.purchases.isDownloadUnlocked(this.photo.filepath)
      : false;
    this.cdr.detectChanges();
  }

  close(): void {
    this.closed.emit();
  }

  async toggleLike(): Promise<void> {
    if (!this.photo) {
      return;
    }

    await this.photoService.toggleLike(this.photo.filepath);
    this.liked.emit(this.photo.filepath);
  }

  async downloadPhoto(): Promise<void> {
    if (!this.photo || this.isDownloading) {
      return;
    }

    this.isDownloading = true;

    try {
      const result = await this.payment.purchasePhotoDownload(this.photo.filepath);

      if (result === 'paid') {
        this.downloadUnlocked = true;
        await this.toast.success('Photo achetée et exportée', 'long');
      } else if (result === 'exported') {
        await this.toast.success('Photo exportée');
      }

      this.cdr.detectChanges();
    } finally {
      this.isDownloading = false;
      this.cdr.detectChanges();
    }
  }

  async confirmDelete(): Promise<void> {
    if (!this.photo) {
      return;
    }

    const filepath = this.photo.filepath;
    const alert = await this.alertController.create({
      header: 'Supprimer cette photo ?',
      message: 'Elle sera retirée de la galerie et de la carte.',
      buttons: [
        { text: 'Annuler', role: 'cancel' },
        {
          text: 'Supprimer',
          role: 'destructive',
          handler: () => {
            void this.deletePhoto(filepath);
          },
        },
      ],
    });

    await alert.present();
  }

  private async deletePhoto(filepath: string): Promise<void> {
    await this.photoService.deletePhoto(filepath);
    this.deleted.emit(filepath);
    this.close();
  }
}
