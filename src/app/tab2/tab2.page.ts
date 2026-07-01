import { ChangeDetectorRef, Component, ElementRef, ViewChild, inject } from '@angular/core';
import { ViewDidEnter, ViewDidLeave } from '@ionic/angular';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { add, locate, location, refresh, remove } from 'ionicons/icons';
import * as L from 'leaflet';
import { PhotoCluster } from '../models/photo-cluster.model';
import { PhotoClusterModalComponent } from '../map/components/photo-cluster-modal/photo-cluster-modal.component';
import { PhotoDetailModalComponent } from '../map/components/photo-detail-modal/photo-detail-modal.component';
import { MapClusterService } from '../map/services/map-cluster.service';
import { MapMarkersService } from '../map/services/map-markers.service';
import { GeolocationService } from '../services/geolocation.service';
import { PermissionsService } from '../services/permissions.service';
import { PhotoService, UserPhoto } from '../services/photo.service';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonFab,
    IonFabButton,
    IonIcon,
    IonButton,
    IonCard,
    IonCardContent,
    IonSpinner,
    PhotoDetailModalComponent,
    PhotoClusterModalComponent,
  ],
})
export class Tab2Page implements ViewDidEnter, ViewDidLeave {
  @ViewChild('map') mapRef!: ElementRef<HTMLElement>;

  currentAddress?: string;
  locating = false;
  mapLoading = false;
  locationError?: string;

  mapPhotoCount = 0;
  photosWithoutLocation = 0;

  detailOpen = false;
  clusterOpen = false;
  selectedPhoto?: UserPhoto;
  selectedCluster?: PhotoCluster;

  geoService = inject(GeolocationService);
  permissions = inject(PermissionsService);
  photoService = inject(PhotoService);
  private mapCluster = inject(MapClusterService);
  private mapMarkers = inject(MapMarkersService);
  private cdr = inject(ChangeDetectorRef);

  private map?: L.Map;
  private userMarker?: L.Marker;
  private markersBound = false;
  private initialCenterDone = false;
  private readonly userLocationIcon = L.divIcon({
    className: 'user-location-marker',
    html: `
      <div class="user-gps-marker" aria-label="Votre position">
        <span class="user-gps-pulse"></span>
        <span class="user-gps-dot"></span>
        <span class="user-gps-label">Vous</span>
      </div>
    `,
    iconSize: [56, 64],
    iconAnchor: [28, 28],
  });

  constructor() {
    addIcons({ add, locate, location, refresh, remove });
    this.photoService.locationUpdated$.subscribe(() => {
      if (this.map) {
        this.renderPhotoMarkers();
        this.cdr.detectChanges();
      }
    });
  }

  zoomIn() {
    this.map?.zoomIn();
  }

  zoomOut() {
    this.map?.zoomOut();
  }

  async ionViewDidEnter() {
    await this.permissions.refresh();

    if (this.permissions.needsLocationRequest()) {
      await this.permissions.requestLocationPermission();
      await this.permissions.refresh();
    }

    void this.geoService.warmUpGps();
    this.cdr.detectChanges();

    if (!this.permissions.canShowMap) {
      this.destroyMap();
      return;
    }

    this.scheduleMapInit();
  }

  ionViewDidLeave() {
    this.destroyMap();
  }

  async requestLocationAccess() {
    const granted = await this.permissions.requestLocationPermission();
    this.cdr.detectChanges();

    if (granted) {
      this.scheduleMapInit();
    } else {
      await this.geoService.showToast(
        'Autorisez la localisation pour afficher la carte',
        'long',
        'error',
      );
    }
  }

  private scheduleMapInit(retry = 0) {
    setTimeout(() => {
      if (!this.permissions.canShowMap) {
        return;
      }

      if (!this.mapRef?.nativeElement) {
        if (retry < 10) {
          this.scheduleMapInit(retry + 1);
        }
        return;
      }

      if (!this.map) {
        this.createMap();
      } else {
        this.map.invalidateSize();
      }

      void this.loadMapData();
    }, 50);
  }

  private createMap() {
    if (!this.mapRef?.nativeElement || this.map) {
      return;
    }

    this.map = L.map(this.mapRef.nativeElement, {
      zoomControl: false,
    }).setView([46.6, 2.4], 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(this.map);

    // Recalcule les clusters à la fin du zoom.
    if (!this.markersBound) {
      this.map.on('zoomend', () => this.renderPhotoMarkers());
      this.markersBound = true;
    }
  }

  private async loadMapData() {
    if (!this.map || this.mapLoading) {
      return;
    }

    this.mapLoading = true;
    this.cdr.detectChanges();

    try {
      await this.photoService.ensureLoaded();
      await this.refreshLiveLocation(false);
      this.renderPhotoMarkers();
    } finally {
      this.mapLoading = false;
      this.cdr.detectChanges();
    }
  }

  private renderPhotoMarkers() {
    if (!this.map) {
      return;
    }

    const photos = this.photoService.getPhotosWithLocation();
    this.mapPhotoCount = photos.length;
    this.photosWithoutLocation = this.photoService.getPhotosWithoutLocationCount();

    const zoom = this.map.getZoom();
    const clusters = this.mapCluster.clusterByPixels(
      photos,
      (lat, lng) => {
        const point = this.map!.project([lat, lng], zoom);
        return { x: point.x, y: point.y };
      },
      zoom,
    );

    this.mapMarkers.render(this.map, clusters, {
      onPhotoClick: (photo) => this.openPhotoDetail(photo),
      onClusterClick: (cluster) => this.openCluster(cluster),
    });
  }

  private openPhotoDetail(photo: UserPhoto) {
    this.selectedPhoto = photo;
    this.detailOpen = true;
    this.cdr.detectChanges();
  }

  private openCluster(cluster: PhotoCluster) {
    if (!this.map) {
      return;
    }

    const bounds = L.latLngBounds(
      cluster.photos.map((photo) => [photo.lat!, photo.lng!] as [number, number]),
    );

    const spiderfyZoom = this.mapCluster.SPIDERFY_ZOOM;
    const sameSpot = !this.boundsHaveSize(bounds);
    const tooMany = cluster.photos.length > 8;

    // Trop de photos au même point → on ne peut pas toutes les écarter
    // lisiblement → modal en grille.
    if (tooMany) {
      this.selectedCluster = cluster;
      this.clusterOpen = true;
      this.cdr.detectChanges();
      return;
    }

    if (sameSpot) {
      // Même point GPS → on zoome jusqu'au niveau "éventail" : les vignettes
      // s'écartent automatiquement autour du pin.
      this.map.setView(
        [cluster.lat, cluster.lng],
        Math.max(this.map.getZoom() + 1, spiderfyZoom),
        { animate: true },
      );
      return;
    }

    // Photos proches mais distinctes → on zoome sur le groupe pour les séparer.
    this.map.fitBounds(bounds, { padding: [80, 80], maxZoom: 18 });
  }

  private boundsHaveSize(bounds: L.LatLngBounds): boolean {
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const epsilon = 1e-6;
    return (
      Math.abs(ne.lat - sw.lat) > epsilon || Math.abs(ne.lng - sw.lng) > epsilon
    );
  }

  closeDetail() {
    this.detailOpen = false;
    this.selectedPhoto = undefined;
  }

  closeCluster() {
    this.clusterOpen = false;
    this.selectedCluster = undefined;
  }

  onClusterPhotoSelected(photo: UserPhoto) {
    this.openPhotoDetail(photo);
  }

  onPhotoLiked(filepath: string) {
    this.selectedPhoto = this.photoService.getPhotoByFilepath(filepath);
    this.cdr.detectChanges();
  }

  onPhotoDeleted() {
    this.closeDetail();
    this.renderPhotoMarkers();
    this.cdr.detectChanges();
  }

  private async refreshLiveLocation(showToast: boolean) {
    if (!this.map || this.locating) {
      return;
    }

    this.locating = true;
    this.locationError = undefined;
    this.cdr.detectChanges();

    try {
      const { lat, lng } = await this.geoService.getCurrentPosition();
      await this.showPosition(lat, lng);

      if (showToast) {
        await this.geoService.showToast(this.currentAddress ?? 'Position trouvée', 'long');
      }
    } catch {
      this.locationError = this.permissions.isLocationDenied()
        ? 'Localisation refusée dans les paramètres Android.'
        : 'Impossible de récupérer la position. Activez le GPS et attendez quelques secondes.';

      if (showToast) {
        await this.geoService.showToast(this.locationError, 'long', 'error');
      }
    } finally {
      this.locating = false;
      this.cdr.detectChanges();
    }
  }

  private async showPosition(lat: number, lng: number) {
    if (!this.map) {
      return;
    }

    this.locationError = undefined;
    this.showUserMarker(lat, lng);

    if (!this.initialCenterDone) {
      this.map.setView([lat, lng], 14, { animate: false });
      this.initialCenterDone = true;
    }

    this.cdr.detectChanges();

    const address = await this.geoService.resolveAddress(lat, lng);
    this.currentAddress = address;
    await this.geoService.savePosition({ lat, lng, address });
    this.cdr.detectChanges();
  }

  private showUserMarker(lat: number, lng: number) {
    if (!this.map) {
      return;
    }

    if (this.userMarker) {
      this.userMarker.remove();
    }

    this.userMarker = L.marker([lat, lng], {
      icon: this.userLocationIcon,
      zIndexOffset: 1000,
      interactive: false,
    }).addTo(this.map);
  }

  async locateMe() {
    if (!this.map) {
      await this.geoService.showToast('La carte n\'est pas encore prête', 'short', 'error');
      return;
    }

    await this.refreshLiveLocation(true);
    const position = this.geoService.position;
    if (position) {
      this.map.setView([position.lat, position.lng], Math.max(this.map.getZoom(), 14), {
        animate: true,
      });
    }
  }

  private destroyMap() {
    this.mapMarkers.clear();
    this.map?.remove();
    this.map = undefined;
    this.markersBound = false;
    this.initialCenterDone = false;
    this.userMarker = undefined;
    this.currentAddress = undefined;
    this.locationError = undefined;
    this.locating = false;
    this.mapLoading = false;
    this.detailOpen = false;
    this.clusterOpen = false;
  }
}
