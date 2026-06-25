import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonImg,
  IonModal,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, heart, locationOutline } from 'ionicons/icons';
import { PhotoCluster } from '../../../models/photo-cluster.model';
import { UserPhoto } from '../../../services/photo.service';

@Component({
  selector: 'app-photo-cluster-modal',
  templateUrl: './photo-cluster-modal.component.html',
  styleUrls: ['./photo-cluster-modal.component.scss'],
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
  ],
})
export class PhotoClusterModalComponent {
  @Input() isOpen = false;
  @Input() cluster?: PhotoCluster;

  @Output() closed = new EventEmitter<void>();
  @Output() photoSelected = new EventEmitter<UserPhoto>();

  constructor() {
    addIcons({ closeOutline, heart, locationOutline });
  }

  close(): void {
    this.closed.emit();
  }

  selectPhoto(photo: UserPhoto): void {
    this.photoSelected.emit(photo);
    this.close();
  }
}
