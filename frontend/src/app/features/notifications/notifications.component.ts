import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { FrenchDatePipe } from '../../shared/french-date.pipe';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, FrenchDatePipe],
  template: `
    <div class="page-container">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <h1 class="page-title">// notifications</h1>
          <p class="page-subtitle">Alertes et événements de la plateforme</p>
        </div>
        <button class="btn btn-secondary btn-sm" (click)="markAllRead()" *ngIf="unreadCount > 0">
          ✓ Tout marquer comme lu ({{unreadCount}})
        </button>
      </div>

      <div *ngIf="loading" class="loading-overlay"><div class="spinner"></div></div>

      <div class="card" style="padding:0;overflow:hidden;" *ngIf="!loading">
        <div *ngIf="notifications.length === 0" class="empty-state" style="padding:48px;">
          <div class="empty-icon">◉</div>
          <div class="empty-title">Aucune notification</div>
          <div class="empty-sub">Vous êtes à jour</div>
        </div>

        <div *ngFor="let n of notifications" class="notif-row" [class.unread]="!n.read"
             (click)="markRead(n)">
          <div class="notif-dot" [style.background]="getTypeColor(n.type)"></div>
          <div style="flex:1;min-width:0;">
            <div class="notif-title">{{n.title}}</div>
            <div class="notif-message">{{n.message}}</div>
            <div class="notif-time">{{n.createdAt | frenchDate}}</div>
          </div>
          <span class="badge {{n.type?.toLowerCase()}}">{{n.type}}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .notif-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background 0.1s;

      &:last-child { border-bottom: none; }
      &:hover { background: var(--bg-hover); }
      &.unread { background: var(--accent-blue-bg); }
      &.unread:hover { background: var(--bg-hover); }
    }

    .notif-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      margin-top: 5px;
      flex-shrink: 0;
    }

    .notif-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 3px;
    }

    .notif-message {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .notif-time {
      font-size: 10px;
      color: var(--text-faint);
      font-family: var(--font-mono);
    }
  `]
})
export class NotificationsComponent implements OnInit {
  notifications: any[] = [];
  loading = false;

  constructor(private api: ApiService, private toast: ToastService) {}

  get unreadCount() { return this.notifications.filter(n => !n.read).length; }

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.api.getNotifications().subscribe({
      next: n => { this.notifications = n; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  markRead(n: any) {
    if (n.read) return;
    this.api.markNotificationRead(n.id).subscribe(() => { n.read = true; });
  }

  markAllRead() {
    this.api.markAllRead().subscribe({
      next: () => {
        this.notifications.forEach(n => n.read = true);
        this.toast.success('Tout marqué comme lu');
      }
    });
  }

  getTypeColor(type: string) {
    const m: any = { ERROR: 'var(--accent-red)', WARNING: 'var(--accent-orange)',
      INFO: 'var(--accent-blue)', SUCCESS: 'var(--accent-green)' };
    return m[type] || 'var(--text-muted)';
  }
}
