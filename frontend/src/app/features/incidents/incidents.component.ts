import { MetricsChartComponent, MetricSeries } from '../../shared/metrics-chart.component';
import { presentationLabel } from '../../shared/status-labels';
// Liste les incidents et leurs états de traitement.
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { PresentationLabelPipe } from '../../shared/presentation-label.pipe';
import { StatusChipComponent } from '../../shared/status-chip/status-chip.component';
import { CopyableIdComponent } from '../../shared/copyable-id/copyable-id.component';
import { ZoneLabelComponent } from '../../shared/zone-label/zone-label.component';
import { frenchDate, frenchRelative } from '../../shared/french-format';

/**
 * Page de liste des incidents : chargement filtré, mise en forme des lignes
 * et réinitialisation des filtres.
 */
export interface IncidentRow {
  id: string;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  source: string | null;
  buildNumber: number | null;
  status: string | null;
  severity: string | null;
  lastActivity: string | null;
  lastActivityExact: string | null;
}

/** Extrait la sévérité d'un incident depuis son analyse IA (null si l'analyse est absente ou en texte brut). */
export function incidentSeverity(incident: any): string | null {
  if (!incident?.aiAnalysis || typeof incident.aiAnalysis !== 'string') return null;
  try {
    return JSON.parse(incident.aiAnalysis)?.securityLevel || null;
  } catch {
    return null;
  }
}

/** Construit une ligne d'affichage à partir d'un incident brut (dates relatives, sévérité, build). */
export function toIncidentRow(incident: any, now: Date = new Date()): IncidentRow {
  const activity = incident?.updatedAt || incident?.createdAt || null;
  const relative = frenchRelative(activity, now);
  const buildNumber = Number.isInteger(incident?.buildNumber) && incident.buildNumber > 0
    ? incident.buildNumber : null;
  return {
    id: String(incident?.id ?? ''),
    title: incident?.title || null,
    projectId: incident?.projectId || incident?.project?.id || null,
    projectName: incident?.project?.name || null,
    source: incident?.sourceType || incident?.source || null,
    buildNumber,
    status: incident?.status || null,
    severity: incidentSeverity(incident),
    lastActivity: relative,
    lastActivityExact: relative && activity ? frenchDate(activity) : null,
  };
}

@Component({
  selector: 'app-incidents',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PresentationLabelPipe, StatusChipComponent, CopyableIdComponent, ZoneLabelComponent, MetricsChartComponent],
  templateUrl: './incidents.component.html',
  styleUrls: ['./incidents.component.scss', '../../shared/metrics-charts.scss'],
})
export class IncidentsComponent implements OnInit {
  statusLabels: string[] = [];
  statusSeries: MetricSeries[] = [];
  dateLabels: string[] = [];
  creationSeries: MetricSeries[] = [];
  chartScope = '';
  incidents: IncidentRow[] = [];
  loadError = '';
  loading = false;
  total = 0;
  size = 50;

  filters = { status: '' };

  /** Initialise les dépendances et l’état de ce composant. */
  constructor(private api: ApiService, private toast: ToastService) {}

  /** Charge la liste des incidents dès l'affichage de la page. */
  ngOnInit() { this.load(); }

  /** Récupère la liste des incidents filtrée et distingue un échec de requête d'une liste simplement vide. */
  load() {
    this.loadError = '';
    this.loading = true;
    const params = { ...this.filters, size: this.size };
    this.api.getIncidents(params).subscribe({
      /** Traite le résultat reçu et actualise les données locales. */
      next: (res: any) => {
        const list = res?.content || res || [];
        this.incidents = list.map((inc: any) => toIncidentRow(inc));
        this.total = res?.totalElements || this.incidents.length;
        this.buildCharts(list);
        this.loading = false;
      },
      /** Traite l’erreur reçue et termine le suivi de la demande. */
      error: () => {
        this.loadError = 'La requête vers le backend n’a pas abouti. Les incidents existants ne sont pas affichés.';
        this.incidents = [];
        this.total = 0;
        this.toast.error('Erreur', 'Impossible de charger les incidents');
        this.loading = false;
      }
    });
  }

  private buildCharts(incidents: any[]) {
    const counts = new Map<string, number>();
    for (const incident of incidents) {
      const status = incident.status || 'unknown';
      counts.set(status, (counts.get(status) || 0) + 1);
    }
    const statuses = [...counts.keys()];
    this.statusLabels = statuses.map(s => s === 'unknown' ? 'Non déterminé' : presentationLabel(s));
    const color = (status: string) => status === 'completed' ? '--accent-green'
      : ['failed', 'blocked', 'rejected'].includes(status) ? '--accent-red'
      : status === 'pending' ? '--accent-orange' : '--accent-blue';
    this.statusSeries = [{ label: 'Incidents', values: statuses.map(s => counts.get(s)!), color: '--accent-blue', colors: statuses.map(color) }];
    const today = new Date();
    const dates = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 29 + index));
      return date.toISOString().slice(0, 10);
    });
    const daily = new Map<string, number>();
    let undated = 0;
    for (const incident of incidents) {
      const date = incident.createdAt ? new Date(incident.createdAt) : null;
      if (!date || !Number.isFinite(date.getTime())) { undated++; continue; }
      const key = date.toISOString().slice(0, 10);
      daily.set(key, (daily.get(key) || 0) + 1);
    }
    this.dateLabels = dates.map(date => date.slice(8, 10) + '/' + date.slice(5, 7));
    this.creationSeries = [{ label: 'Incidents créés', values: dates.map(date => daily.get(date) || 0), color: '--accent-blue' }];
    this.chartScope = (incidents.length >= this.size ? 'Sur les ' + this.size + ' incidents les plus récents' : 'Sur les ' + incidents.length + ' incidents affichés')
      + (this.filters.status ? ', avec le filtre de statut actif.' : ', tous statuts confondus.')
      + (undated ? ' ' + undated + ' incident(s) sans date exploitable exclus de la courbe.' : '');
  }

  /** Réinitialise les filtres (statut) et recharge la liste complète. */
  resetFilters() {
    this.filters = { status: '' };
    this.load();
  }
}
