import { Component, OnInit, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { PushNotifications } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';
import { environment } from '../environments/environment';
import { ToastService } from './services/toast.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent implements OnInit {
  private toast = inject(ToastService);
  ngOnInit() {
    if (Capacitor.isNativePlatform()) {
      void SplashScreen.hide().catch(() => undefined);
      void this.initPushNotifications();
    }
  }

  private async initPushNotifications() {
    await PushNotifications.addListener('registration', async token => {
      console.info('Registration token: ', token.value);
      await Preferences.set({ key: 'fcm_token', value: token.value });
      try {
        await fetch(`${environment.stripe.backendUrl}/register-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token.value }),
        });
      } catch (e) {
        console.error('Erreur envoi token:', e);
      }
    });

    await PushNotifications.addListener('registrationError', err => {
      console.error('Registration error: ', err.error);
    });

    await PushNotifications.addListener('pushNotificationReceived', notification => {
      const msg = notification.title ? `${notification.title} — ${notification.body}` : (notification.body ?? '');
      void this.toast.show(msg, 'long');
    });

    await PushNotifications.addListener('pushNotificationActionPerformed', notification => {
      console.log('Push notification action performed', notification.actionId, notification.inputValue);
    });

    let permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === 'prompt' || permStatus.receive === 'prompt-with-rationale') {
      permStatus = await PushNotifications.requestPermissions();
    }
    if (permStatus.receive !== 'granted') return;
    await PushNotifications.register();
  }
}
