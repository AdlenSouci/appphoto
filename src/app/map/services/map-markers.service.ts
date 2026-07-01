import { Injectable } from '@angular/core';
import * as L from 'leaflet';
import { PhotoCluster } from '../../models/photo-cluster.model';
import { UserPhoto } from '../../services/photo.service';

export interface MapMarkerHandlers {
  onPhotoClick: (photo: UserPhoto) => void;
  onClusterClick: (cluster: PhotoCluster) => void;
}

@Injectable({ providedIn: 'root' })
export class MapMarkersService {
  private photoLayer?: L.LayerGroup;

  render(
    map: L.Map,
    clusters: PhotoCluster[],
    handlers: MapMarkerHandlers,
  ): void {
    this.clear();

    this.photoLayer = L.layerGroup();

    for (const cluster of clusters) {
      const marker = cluster.isCluster
        ? this.createClusterMarker(cluster, handlers)
        : this.createPhotoMarker(cluster, handlers);

      marker.addTo(this.photoLayer);
    }

    this.photoLayer.addTo(map);
  }

  clear(): void {
    this.photoLayer?.clearLayers();
    this.photoLayer = undefined;
  }

  private createPhotoMarker(
    cluster: PhotoCluster,
    handlers: MapMarkerHandlers,
  ): L.Marker {
    const photo = cluster.photos[0];
    const icon = L.divIcon({
      className: 'map-photo-marker',
      html: `<img class="map-photo-thumb" src="${photo.webviewPath}" alt="Photo" />`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    return L.marker([cluster.lat, cluster.lng], {
      icon,
      zIndexOffset: 200,
    }).on('click', () => {
      handlers.onPhotoClick(photo);
    });
  }

  private createClusterMarker(
    cluster: PhotoCluster,
    handlers: MapMarkerHandlers,
  ): L.Marker {
    const icon = L.divIcon({
      className: 'map-cluster-marker',
      html: `<div class="map-cluster-badge">${cluster.photos.length}</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    return L.marker([cluster.lat, cluster.lng], {
      icon,
      zIndexOffset: 200,
    }).on('click', () => {
      handlers.onClusterClick(cluster);
    });
  }
}
