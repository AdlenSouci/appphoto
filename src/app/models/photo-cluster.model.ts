import { UserPhoto } from '../services/photo.service';

export interface PhotoCluster {
  id: string;
  lat: number;
  lng: number;
  photos: UserPhoto[];
  isCluster: boolean;
  /** Décalage écran (px) quand des photos au même point sont écartées en éventail. */
  pixelOffsetX?: number;
  pixelOffsetY?: number;
}
