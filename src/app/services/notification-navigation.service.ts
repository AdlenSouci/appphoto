import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';

/** Ouvre une photo depuis une notification (clic ou cold start). */
@Injectable({ providedIn: 'root' })
export class NotificationNavigationService {
  private router = inject(Router);

  readonly openPhoto$ = new Subject<string>();

  async navigateToPhoto(filepath: string): Promise<void> {
    if (!filepath) {
      return;
    }

    await this.router.navigate(['/tabs/tab2']);
    setTimeout(() => this.openPhoto$.next(filepath), 350);
  }

  async navigateToTab(tab: 'tab1' | 'tab2' | 'tab3'): Promise<void> {
    await this.router.navigate([`/tabs/${tab}`]);
  }
}
