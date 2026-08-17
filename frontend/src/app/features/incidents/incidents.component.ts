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
  templateUrl: './incidents.component.html',
  styleUrls: ['./incidents.component.scss'],
})
export class IncidentsComponent implements OnInit {
  incidents: any[] = [];
  loading = false;
  total = 0;
  // Pas de pagination : size=50 couvre le plus gros bucket de statut réel
  // (pending=45, vérifié en base) avec marge. Le filtre Statut fait le
  // travail de navigation — chaque vue filtrée tient sur une seule page.
  size = 50;

  filters = { status: '' };

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    const params = {
      ...this.filters,
      size: this.size
    };
    this.api.getIncidents(params).subscribe({
      next: (res: any) => {
        const list = res.content || res;
        // Sévérité pré-calculée une fois ici (pas dans le template) — même
        // source et même règle de parsing que incident-detail.component.ts,
        // pour que la liste et le détail affichent toujours la même valeur.
        this.incidents = list.map((inc: any) => ({ ...inc, _severity: this.parseSeverity(inc) }));
        this.total      = res.totalElements || this.incidents.length;
        this.loading     = false;
      },
      error: () => {
        this.toast.error('Erreur', 'Impossible de charger les incidents');
        this.loading = false;
      }
    });
  }

  resetFilters() {
    this.filters = { status: '' };
    this.load();
  }

  // Identique à incident-detail.component.ts — aiAnalysis peut être du JSON
  // string ou du texte brut. Texte brut ou absent => pas de securityLevel
  // exploitable => null (jamais une sévérité inventée pour combler).
  private parseSeverity(inc: any): string | null {
    if (!inc.aiAnalysis || typeof inc.aiAnalysis !== 'string') return null;
    try {
      return JSON.parse(inc.aiAnalysis)?.securityLevel || null;
    } catch {
      return null;
    }
  }

  // Mêmes fonctions que incident-detail.component.ts — une seule source de
  // vérité pour la couleur/le libellé de sévérité entre liste et détail.
  getSeverityColor(s: string | null) {
    const map: any = { CRITICAL: 'var(--accent-red)', HIGH: 'var(--accent-red)',
      MEDIUM: 'var(--accent-orange)', LOW: 'var(--accent-green)' };
    return map[s as string] || 'var(--border)';
  }
  getSeverityBadgeClass(s: string | null) {
    const map: any = { CRITICAL: 'high', HIGH: 'high', MEDIUM: 'medium', LOW: 'info' };
    return map[s as string] || '';
  }
}
