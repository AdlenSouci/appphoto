import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonChip,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonLabel,
  IonModal,
  IonRange,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  brushOutline,
  closeOutline,
  colorPaletteOutline,
  checkmarkOutline,
  imagesOutline,
} from 'ionicons/icons';
import { GeolocationService } from '../../services/geolocation.service';
import { PaymentService } from '../../services/payment.service';
import { PremiumService } from '../../services/premium.service';
import { UserPhoto } from '../../services/photo.service';

export type EditorMode = 'filters' | 'draw';

interface PhotoFilterPreset {
  id: string;
  label: string;
  css: string;
}

@Component({
  selector: 'app-photo-editor',
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.scss'],
  imports: [
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonFooter,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonChip,
    IonRange,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
  ],
})
export class PhotoEditorComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() photo?: UserPhoto;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  @ViewChild('imageCanvas') imageCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawCanvas') drawCanvas?: ElementRef<HTMLCanvasElement>;

  premium = inject(PremiumService);
  private payment = inject(PaymentService);
  private geoService = inject(GeolocationService);

  editorMode: EditorMode = 'filters';
  activeFilter = 'none';
  brushSize = 6;
  brushColor = '#e53935';
  isDrawing = false;
  isPurchasing = false;
  canvasReady = false;

  readonly filters: PhotoFilterPreset[] = [
    { id: 'none', label: 'Original', css: 'none' },
    { id: 'grayscale', label: 'N&B', css: 'grayscale(100%)' },
    { id: 'sepia', label: 'Sépia', css: 'sepia(85%)' },
    { id: 'warm', label: 'Chaud', css: 'sepia(35%) saturate(140%)' },
    { id: 'cool', label: 'Froid', css: 'saturate(120%) hue-rotate(15deg)' },
    { id: 'vivid', label: 'Vif', css: 'contrast(115%) saturate(150%)' },
  ];

  readonly brushColors = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#ffffff', '#212121'];

  private image = new Image();
  private lastPoint?: { x: number; y: number };

  constructor() {
    addIcons({
      closeOutline,
      checkmarkOutline,
      imagesOutline,
      brushOutline,
      colorPaletteOutline,
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']?.currentValue && this.photo) {
      void this.premium.refresh().then(() => {
        if (this.premium.isPremium) {
          setTimeout(() => this.initCanvas(), 150);
        }
      });
    }

    if (changes['isOpen']?.currentValue === false) {
      this.canvasReady = false;
      this.clearDrawLayer();
    }
  }

  onModalDidPresent(): void {
    void this.premium.refresh().then(() => {
      if (this.premium.isPremium && this.photo) {
        this.initCanvas();
      }
    });
  }

  close(): void {
    this.closed.emit();
  }

  async purchasePremium(): Promise<void> {
    this.isPurchasing = true;
    const success = await this.payment.purchaseEditorPremium();
    this.isPurchasing = false;

    if (success) {
      await this.premium.unlock();
      this.initCanvas();
    }
  }

  setMode(mode: EditorMode): void {
    this.editorMode = mode;
  }

  applyFilter(filterId: string): void {
    this.activeFilter = filterId;
    this.redrawImage();
  }

  selectColor(color: string): void {
    this.brushColor = color;
  }

  onBrushSizeChange(event: CustomEvent): void {
    this.brushSize = event.detail.value as number;
  }

  startDraw(event: PointerEvent): void {
    if (this.editorMode !== 'draw' || !this.drawCanvas) {
      return;
    }

    this.isDrawing = true;
    this.lastPoint = this.getCanvasPoint(event, this.drawCanvas.nativeElement);
  }

  drawMove(event: PointerEvent): void {
    if (!this.isDrawing || !this.drawCanvas || !this.lastPoint) {
      return;
    }

    const canvas = this.drawCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const point = this.getCanvasPoint(event, canvas);
    ctx.strokeStyle = this.brushColor;
    ctx.lineWidth = this.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.lastPoint.x, this.lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    this.lastPoint = point;
  }

  endDraw(): void {
    this.isDrawing = false;
    this.lastPoint = undefined;
  }

  clearDrawing(): void {
    this.clearDrawLayer();
  }

  async save(): Promise<void> {
    if (!this.imageCanvas || !this.drawCanvas) {
      return;
    }

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.imageCanvas.nativeElement.width;
    exportCanvas.height = this.imageCanvas.nativeElement.height;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.drawImage(this.imageCanvas.nativeElement, 0, 0);
    ctx.drawImage(this.drawCanvas.nativeElement, 0, 0);
    this.saved.emit(exportCanvas.toDataURL('image/jpeg', 0.92));
    this.close();
    await this.geoService.showToast('Photo enregistrée');
  }

  private initCanvas(): void {
    if (!this.photo || !this.imageCanvas || !this.drawCanvas) {
      return;
    }

    this.image.onload = () => {
      const maxWidth = 1080;
      const scale = Math.min(1, maxWidth / this.image.width);
      const width = Math.round(this.image.width * scale);
      const height = Math.round(this.image.height * scale);

      const imageCanvas = this.imageCanvas!.nativeElement;
      const drawCanvas = this.drawCanvas!.nativeElement;
      imageCanvas.width = width;
      imageCanvas.height = height;
      drawCanvas.width = width;
      drawCanvas.height = height;

      this.redrawImage();
      this.clearDrawLayer();
      this.canvasReady = true;
    };

    this.image.src = this.photo.webviewPath;
  }

  private redrawImage(): void {
    if (!this.imageCanvas) {
      return;
    }

    const canvas = this.imageCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const preset = this.filters.find((f) => f.id === this.activeFilter);
    ctx.filter = preset?.css ?? 'none';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.image, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
  }

  private clearDrawLayer(): void {
    if (!this.drawCanvas) {
      return;
    }

    const canvas = this.drawCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  private getCanvasPoint(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
  ): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }
}
