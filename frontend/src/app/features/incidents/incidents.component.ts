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
 * Ligne de liste d'incidents, telle qu'affichée (§10).
 *
 * Construite ici et PAS dans le gabarit : la sévérité se lit dans un champ
 * JSON, la fraîcheur se calcule, et un gabarit qui refait ces deux choses à
 * chaque cycle de rendu finit par en donner deux versions différentes entre
 * la liste et le détail. Un champ sans fait constaté reste `null` — le
 * gabarit affiche alors une absence, jamais un zéro ni un repli inventé.
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

/**
 * Sévérité d'un incident — même source et même règle de lecture que
 * incident-detail.component.ts. `aiAnalysis` peut être du JSON ou du texte
 * brut : du texte brut ne porte pas de securityLevel, donc pas de sévérité,
 * donc null (jamais une sévérité inventée pour remplir la colonne).
 */
export function incidentSeverity(incident: any): string | null {
  if (!incident?.aiAnalysis || typeof incident.aiAnalysis !== 'string') return null;
  try {
    return JSON.parse(incident.aiAnalysis)?.securityLevel || null;
  } catch {
    return null;
  }
}

export function toIncidentRow(incident: any, now: Date = new Date()): IncidentRow {
  // La dernière activité est updatedAt quand il existe, sinon la détection.
  // Les deux sont des faits enregistrés ; aucun n'est substitué à « maintenant ».
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
  imports: [CommonModule, RouterModule, FormsModule, PresentationLabelPipe, StatusChipComponent, CopyableIdComponent, ZoneLabelComponent],
  templateUrl: './incidents.component.html',
  styleUrls: ['./incidents.component.scss'],
})
export class IncidentsComponent implements OnInit {
  incidents: IncidentRow[] = [];
  loadError = '';
  loading = false;
  total = 0;
  // Taille de chargement, jamais un compteur ou une hypothèse sur les données.
  size = 50;

  filters = { status: '' };

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loadError = '';
    this.loading = true;
    const params = { ...this.filters, size: this.size };
    this.api.getIncidents(params).subscribe({
      next: (res: any) => {
        const list = res?.content || res || [];
        this.incidents = list.map((inc: any) => toIncidentRow(inc));
        this.total = res?.totalElements || this.incidents.length;
        this.loading = false;
      },
      error: () => {
        // §17 — « la requête a échoué » et « aucun incident » sont deux faits
        // distincts : la liste n'affiche jamais l'un à la place de l'autre.
        this.loadError = 'La requête vers le backend n’a pas abouti. Les incidents existants ne sont pas affichés.';
        this.incidents = [];
        this.total = 0;
        this.toast.error('Erreur', 'Impossible de charger les incidents');
        this.loading = false;
      }
    });
  }

  resetFilters() {
    this.filters = { status: '' };
    this.load();
  }
}
