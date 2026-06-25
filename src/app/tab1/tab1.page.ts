import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { ViewDidEnter } from '@ionic/angular';
import { AlertController } from '@ionic/angular/standalone';
import {
  IonButton,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonImg,
  IonCol,
  IonGrid,
  IonLabel,
  IonRow,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  camera,
  createOutline,
  heart,
  heartOutline,
  locationOutline,
  trashOutline,
} from 'ionicons/icons';
import { PhotoEditorComponent } from '../components/photo-editor/photo-editor.component';
import { PhotoDetailModalComponent } from '../map/components/photo-detail-modal/photo-detail-modal.component';
import { GeolocationService } from '../services/geolocation.service';
import { PermissionsService } from '../services/permissions.service';
import {
  GalleryFilter,
  GALLERY_SKELETON_THRESHOLD,
  PhotoService,
  UserPhoto,
} from '../services/photo.service';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonIcon,
    IonFabButton,
    IonFab,
    IonGrid,
    IonRow,
    IonCol,
    IonImg,
    IonButton,
    IonSegment,
    IonSegmentButton,
    IonSpinner,
    IonLabel,
    PhotoEditorComponent,
    PhotoDetailModalComponent,
  ],
})
export class Tab1Page implements ViewDidEnter {
  photoService = inject(PhotoService);
  permissions = inject(PermissionsService);
  private geoService = inject(GeolocationService);
  private alertController = inject(AlertController);
  private cdr = inject(ChangeDetectorRef);

  galleryLoading = false;
  skeletonCount = 0;
  galleryFilter: GalleryFilter = 'all';
  editorOpen = false;
  editingPhoto?: UserPhoto;
  detailOpen = false;
  selectedPhoto?: UserPhoto;

  constructor() {
    addIcons({ camera, createOutline, heart, heartOutline, locationOutline, trashOutline });
  }

  get skeletonSlots(): number[] {
    return Array.from({ length: this.skeletonCount }, (_, index) => index);
  }

  get showGallerySkeleton(): boolean {
    return this.galleryLoading && this.skeletonCount >= GALLERY_SKELETON_THRESHOLD;
  }

  get displayedPhotos() {
    return this.photoService.getFilteredPhotos(this.galleryFilter);
  }

  async ionViewDidEnter() {
    await this.permissions.refresh();
    this.cdr.detectChanges();
    await this.loadGallery();
  }

  private async loadGallery() {
    const count = await this.photoService.getSavedCount();

    if (count >= GALLERY_SKELETON_THRESHOLD) {
      this.galleryLoading = true;
      this.skeletonCount = count;
      this.cdr.detectChanges();
    }

    await this.photoService.loadSaved();

    this.galleryLoading = false;
    this.skeletonCount = 0;
    this.cdr.detectChanges();
  }

  onFilterChange(event: CustomEvent) {
    this.galleryFilter = event.detail.value as GalleryFilter;
  }

  async toggleLike(filepath: string) {
    await this.photoService.toggleLike(filepath);
    this.cdr.detectChanges();
  }

  openEditor(photo: UserPhoto) {
    this.editingPhoto = photo;
    this.editorOpen = true;
  }

  openPhotoDetail(photo: UserPhoto) {
    this.selectedPhoto = photo;
    this.detailOpen = true;
  }

  closeDetail() {
    this.detailOpen = false;
    this.selectedPhoto = undefined;
  }

  onPhotoLiked(filepath: string) {
    this.selectedPhoto = this.photoService.getPhotoByFilepath(filepath);
    this.cdr.detectChanges();
  }

  onPhotoDeleted() {
    this.closeDetail();
    this.cdr.detectChanges();
  }

  closeEditor() {
    this.editorOpen = false;
    this.editingPhoto = undefined;
  }

  async onPhotoEdited(dataUrl: string) {
    if (!this.editingPhoto) {
      return;
    }

    await this.photoService.updatePhoto(this.editingPhoto.filepath, dataUrl);
    this.cdr.detectChanges();
  }

  async confirmDelete(filepath: string) {
    const alert = await this.alertController.create({
      header: 'Supprimer cette photo ?',
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

  private async deletePhoto(filepath: string) {
    await this.photoService.deletePhoto(filepath);
    this.cdr.detectChanges();
    await this.geoService.showToast('Photo supprimée');
  }

  async takePhoto() {
    const success = await this.photoService.takePhoto();
    if (!success) {
      await this.geoService.showToast(
        'Autorisez la caméra pour prendre une photo',
        'long',
      );
      return;
    }

    this.cdr.detectChanges();
  }
}
