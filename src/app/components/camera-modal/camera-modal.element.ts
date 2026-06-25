class CameraModal extends HTMLElement {
  facingMode: 'user' | 'environment' = 'environment';

  private video!: HTMLVideoElement;
  private canvas!: HTMLCanvasElement;
  private stream: MediaStream | null = null;
  private modal!: HTMLDivElement;

  componentOnReady() {
    return Promise.resolve();
  }

  async present() {
    this.render();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode },
        audio: false,
      });
      this.video.srcObject = this.stream;
    } catch (err) {
      this.dispatchEvent(new CustomEvent('onPhoto', { detail: err }));
    }
  }

  dismiss() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.modal?.remove();
  }

  private render() {
    this.modal = document.createElement('div');
    this.modal.style.cssText = `
      position: fixed; inset: 0; z-index: 99999;
      background: #000; display: flex; flex-direction: column;
    `;

    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.style.cssText = `flex: 1; width: 100%; object-fit: cover;`;

    const controls = document.createElement('div');
    controls.style.cssText = `
      display: flex; justify-content: space-around; align-items: center;
      padding: 24px; background: #000;
    `;

    const cancelBtn = this.makeButton('Annuler', '#fff', 'transparent');
    cancelBtn.onclick = () => this.cancel();

    const shutterBtn = document.createElement('button');
    shutterBtn.style.cssText = `
      width: 72px; height: 72px; border-radius: 50%;
      background: #fff; border: 4px solid #ccc; cursor: pointer;
    `;
    shutterBtn.onclick = () => this.capture();

    controls.append(cancelBtn, shutterBtn);

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'none';

    this.modal.append(this.video, controls, this.canvas);
    document.body.appendChild(this.modal);
  }

  private makeButton(label: string, color: string, bg: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      color: ${color}; background: ${bg}; border: none;
      font-size: 16px; padding: 12px 20px; cursor: pointer;
    `;
    return btn;
  }

  private capture() {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d')!;
    ctx.drawImage(this.video, 0, 0, w, h);

    this.canvas.toBlob(blob => {
      this.dispatchEvent(new CustomEvent('onPhoto', { detail: blob }));
    }, 'image/jpeg', 0.95);
  }

  private cancel() {
    this.dispatchEvent(new CustomEvent('onPhoto', { detail: null }));
  }
}

if (!customElements.get('pwa-camera-modal')) {
  customElements.define('pwa-camera-modal', CameraModal);
}