import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container">
      <div *ngFor="let t of toastService.toasts$ | async"
           class="toast {{t.type}}"
           (click)="toastService.remove(t.id)">
        <span class="toast-icon">
          <ng-container [ngSwitch]="t.type">
            <span *ngSwitchCase="'success'">✓</span>
            <span *ngSwitchCase="'error'">✕</span>
            <span *ngSwitchCase="'warning'">⚠</span>
            <span *ngSwitchDefault>ℹ</span>
          </ng-container>
        </span>
        <div>
          <div style="font-weight:500;font-size:13px;">{{t.title}}</div>
          <div *ngIf="t.message" style="font-size:11px;opacity:0.8;margin-top:2px;">{{t.message}}</div>
        </div>
      </div>
    </div>
  `
})
export class ToastComponent {
  constructor(public toastService: ToastService) {}
}
