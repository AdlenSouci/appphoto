import { Component, OnInit, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { PhotoService } from './services/photo.service';
import { PushNotificationService } from './services/push-notification.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {
  private push = inject(PushNotificationService);
  private photoService = inject(PhotoService);

  ngOnInit() {
    if (Capacitor.isNativePlatform()) {
      void SplashScreen.hide().catch(() => undefined);
      void this.push.init();
    }

    void this.photoService.ensureLoaded();
  }
}
