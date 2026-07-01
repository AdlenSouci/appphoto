import { Injectable } from '@angular/core';
import { PhotoCluster } from '../../models/photo-cluster.model';
import { UserPhoto } from '../../services/photo.service';

export type ProjectFn = (lat: number, lng: number) => { x: number; y: number };

@Injectable({ providedIn: 'root' })
export class MapClusterService {
  /**
   * Rayon (pixels à l'écran) en dessous duquel deux photos sont regroupées.
   * Comme on projette en pixels au zoom courant, le regroupement se défait
   * automatiquement quand on zoome (les vignettes s'écartent).
   */
  private readonly CLUSTER_RADIUS_PX = 64;

  /** Zoom à partir duquel un petit groupe au même point s'écarte en éventail. */
  readonly SPIDERFY_ZOOM = 15;

  /** Au-delà de ce nombre de photos, on garde le badge (→ modal au clic). */
  private readonly MAX_SPIDERFY = 8;

  /**
   * Regroupe les photos selon leur distance EN PIXELS au zoom courant.
   * - 1 photo seule → vignette
   * - plusieurs photos proches, zoom élevé, peu nombreuses → écartées en éventail
   * - sinon → badge numéroté (cluster)
   */
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

      // Zoom élevé + peu de photos → on les écarte en éventail (spiderfy)
      // pour qu'elles deviennent des vignettes cliquables, même au même point GPS.
      if (zoom >= this.SPIDERFY_ZOOM && groupPhotos.length <= this.MAX_SPIDERFY) {
        const offsets = this.fanOffsetsMeters(groupPhotos.length);
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

  /**
   * Décalages en mètres pour écarter des vignettes au même point GPS.
   * En coordonnées réelles (pas en pixels) → stable au zoom/dézoom.
   */
  private fanOffsetsMeters(count: number): { x: number; y: number }[] {
    if (count === 2) {
      return [
        { x: -14, y: 0 },
        { x: 14, y: 0 },
      ];
    }

    const radius = Math.max(16, 10 + count * 2);
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
