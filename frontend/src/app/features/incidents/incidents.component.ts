import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-incidents',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="page-container">
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <h1 class="page-title">// incidents</h1>
          <p class="page-subtitle">Gestion et suivi des incidents détectés par la plateforme IA</p>
        </div>
        <div class="live-indicator">
          <div class="live-dot"></div> {{total}} incidents
        </div>
      </div>

      <!-- Filters -->
      <div class="card" style="margin-bottom:16px;padding:14px 20px;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
          <select class="form-control" [(ngModel)]="filters.severity" (change)="load()" style="width:140px;">
            <option value="">Toutes sévérités</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
          <select class="form-control" [(ngModel)]="filters.status" (change)="load()" style="width:180px;">
            <option value="">Tous statuts</option>
            <option value="OPEN">OPEN</option>
            <option value="ANALYZING">ANALYZING</option>
            <option value="CORRECTION_PROPOSED">CORRECTION_PROPOSED</option>
            <option value="CORRECTION_APPLIED">CORRECTION_APPLIED</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
          <select class="form-control" [(ngModel)]="filters.source" (change)="load()" style="width:140px;">
            <option value="">Toutes sources</option>
            <option value="JENKINS">JENKINS</option>
            <option value="SONARQUBE">SONARQUBE</option>
            <option value="DOCKER">DOCKER</option>
            <option value="GITHUB">GITHUB</option>
          </select>
          <input class="form-control" [(ngModel)]="filters.search"
                 placeholder="Rechercher..." style="flex:1;min-width:160px;"
                 (input)="onSearch()" />
          <button class="btn btn-secondary btn-sm" (click)="resetFilters()">↺ Reset</button>
        </div>
      </div>

      <!-- Table -->
      <div class="card" style="padding:0;overflow:hidden;">
        <div *ngIf="loading" class="loading-overlay"><div class="spinner"></div><span>Chargement...</span></div>

        <table class="data-table" *ngIf="!loading">
          <thead>
            <tr>
              <th>Incident ID</th>
              <th>Titre</th>
              <th>Source</th>
              <th>Sévérité</th>
              <th>Statut</th>
              <th>Créé le</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngIf="incidents.length === 0">
              <td colspan="7" style="text-align:center;padding:40px;color:var(--text-faint);">
                Aucun incident trouvé
              </td>
            </tr>
            <tr *ngFor="let inc of incidents">
              <td>
                <span style="font-family:var(--font-mono);font-size:11px;color:var(--accent-blue);">
                  {{inc.incidentId?.substring(0,24)}}...
                </span>
              </td>
              <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                {{inc.title || 'Incident ' + inc.sourceType}}
              </td>
              <td>
                <span class="source-tag">{{inc.sourceType}}</span>
              </td>
              <td><span class="badge {{inc.severity?.toLowerCase()}}">{{inc.severity}}</span></td>
              <td><span class="badge {{inc.status?.toLowerCase()}}">{{inc.status}}</span></td>
              <td style="font-family:var(--font-mono);font-size:11px;">
                {{inc.createdAt | date:'dd/MM/yy HH:mm'}}
              </td>
              <td>
                <a [routerLink]="['/incidents', inc.id]" class="btn btn-secondary btn-sm">
                  Voir →
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;" *ngIf="totalPages > 1">
        <span style="font-size:11px;color:var(--text-muted);">
          Page {{page + 1}} / {{totalPages}} — {{total}} résultats
        </span>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-secondary btn-sm" [disabled]="page === 0" (click)="prevPage()">← Préc.</button>
          <button class="btn btn-secondary btn-sm" [disabled]="page >= totalPages - 1" (click)="nextPage()">Suiv. →</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .source-tag {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      background: var(--bg-tertiary);
      border: 1px solid var(--border);
      padding: 2px 7px;
      border-radius: var(--radius-sm);
    }
  `]
})
export class IncidentsComponent implements OnInit {
  incidents: any[] = [];
  loading = false;
  total = 0;
  page  = 0;
  size  = 15;
  totalPages = 0;

  filters = { severity: '', status: '', source: '', search: '' };
  private searchTimer: any;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    const params = {
      ...this.filters,
      page: this.page,
      size: this.size
    };
    this.api.getIncidents(params).subscribe({
      next: (res: any) => {
        this.incidents   = res.content || res;
        this.total       = res.totalElements || this.incidents.length;
        this.totalPages  = res.totalPages || 1;
        this.loading     = false;
      },
      error: () => {
        this.toast.error('Erreur', 'Impossible de charger les incidents');
        this.loading = false;
      }
    });
  }

  onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 400);
  }

  resetFilters() {
    this.filters = { severity: '', status: '', source: '', search: '' };
    this.page = 0;
    this.load();
  }

  prevPage() { if (this.page > 0) { this.page--; this.load(); } }
  nextPage() { if (this.page < this.totalPages - 1) { this.page++; this.load(); } }
}
