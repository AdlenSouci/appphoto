import { Injectable } from '@angular/core';
import { PhotoCluster } from '../../models/photo-cluster.model';
import { UserPhoto } from '../../services/photo.service';

export type ProjectFn = (lat: number, lng: number) => { x: number; y: number };

@Injectable({ providedIn: 'root' })
export class MapClusterService {
  private readonly CLUSTER_RADIUS_PX = 52;

  readonly SPIDERFY_ZOOM = 13;

  /** 3+ photos au même point GPS → badge + modal. */
  private readonly MODAL_CLUSTER_MIN = 3;

  clusterByPixels(
    photos: UserPhoto[],
    project: ProjectFn,
    zoom: number,
    radiusPx: number = this.CLUSTER_RADIUS_PX,
  ): PhotoCluster[] {
    const located = photos.filter(
      (photo) => photo.lat != null && photo.lng != null,
    );

    const points = located.map((photo) => ({
      photo,
      pt: project(photo.lat!, photo.lng!),
      used: false,
    }));

    const clusters: PhotoCluster[] = [];

    for (let i = 0; i < points.length; i++) {
      if (points[i].used) {
        continue;
      }

      points[i].used = true;
      const group = [points[i]];

      for (let j = i + 1; j < points.length; j++) {
        if (points[j].used) {
          continue;
        }

        const dx = points[i].pt.x - points[j].pt.x;
        const dy = points[i].pt.y - points[j].pt.y;
        if (Math.hypot(dx, dy) <= radiusPx) {
          points[j].used = true;
          group.push(points[j]);
        }
      }

      const groupPhotos = group.map((entry) => entry.photo);

      if (groupPhotos.length === 1) {
        clusters.push({
          id: groupPhotos[0].filepath,
          lat: groupPhotos[0].lat!,
          lng: groupPhotos[0].lng!,
          photos: groupPhotos,
          isCluster: false,
        });
        continue;
      }

      const center = this.center(groupPhotos);
      const sameGps = this.sameGpsPoint(groupPhotos);

      // 3+ au même endroit → badge cliquable (ouvre la modal grille).
      if (sameGps && groupPhotos.length >= this.MODAL_CLUSTER_MIN) {
        clusters.push({
          id: `cluster-${center.lat.toFixed(5)}-${center.lng.toFixed(5)}-${groupPhotos.length}`,
          lat: center.lat,
          lng: center.lng,
          photos: groupPhotos,
          isCluster: true,
        });
        continue;
      }

      // 2 au même endroit → écartées en mètres (visibles sans zoomer).
      if (sameGps && groupPhotos.length === 2) {
        const offsets = this.fanOffsetsMeters(2);
        groupPhotos.forEach((photo, index) => {
          const position = this.applyMeterOffset(
            center.lat,
            center.lng,
            offsets[index].x,
            offsets[index].y,
          );
          clusters.push({
            id: `${photo.filepath}-fan`,
            lat: position.lat,
            lng: position.lng,
            photos: [photo],
            isCluster: false,
          });
        });
        continue;
      }

      // Plusieurs photos proches (pas exactement au même point).
      if (zoom >= this.SPIDERFY_ZOOM && groupPhotos.length === 2) {
        const offsets = this.fanOffsetsMeters(2);
        groupPhotos.forEach((photo, index) => {
          const position = this.applyMeterOffset(
            center.lat,
            center.lng,
            offsets[index].x,
            offsets[index].y,
          );
          clusters.push({
            id: `${photo.filepath}-fan`,
            lat: position.lat,
            lng: position.lng,
            photos: [photo],
            isCluster: false,
          });
        });
        continue;
      }

      clusters.push({
        id: `cluster-${center.lat.toFixed(5)}-${center.lng.toFixed(5)}-${groupPhotos.length}`,
        lat: center.lat,
        lng: center.lng,
        photos: groupPhotos,
        isCluster: true,
      });
    }

    return clusters;
  }

  private sameGpsPoint(photos: UserPhoto[]): boolean {
    const lat = photos[0].lat!.toFixed(5);
    const lng = photos[0].lng!.toFixed(5);
    return photos.every(
      (photo) =>
        photo.lat!.toFixed(5) === lat && photo.lng!.toFixed(5) === lng,
    );
  }

  private fanOffsetsMeters(count: number): { x: number; y: number }[] {
    if (count === 2) {
      return [
        { x: -22, y: 0 },
        { x: 22, y: 0 },
      ];
    }

    const radius = Math.max(22, 12 + count * 3);
    const offsets: { x: number; y: number }[] = [];
    for (let index = 0; index < count; index++) {
      const angle = (2 * Math.PI * index) / count - Math.PI / 2;
      offsets.push({
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    }

    return offsets;
  }

  private applyMeterOffset(
    lat: number,
    lng: number,
    eastMeters: number,
    northMeters: number,
  ): { lat: number; lng: number } {
    const latRad = (lat * Math.PI) / 180;
    const dLat = northMeters / 110540;
    const dLng = eastMeters / (111320 * Math.cos(latRad));
    return { lat: lat + dLat, lng: lng + dLng };
  }

  private center(photos: UserPhoto[]): { lat: number; lng: number } {
    const lat =
      photos.reduce((sum, photo) => sum + photo.lat!, 0) / photos.length;
    const lng =
      photos.reduce((sum, photo) => sum + photo.lng!, 0) / photos.length;
    return { lat, lng };
  }
}
