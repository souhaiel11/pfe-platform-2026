import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { remediationTypeLabel } from '../../shared/status-labels';

// ─────────────────────────────────────────────────────────────────────
//  Tableau des alertes ZAP (DAST) — clic sur une ligne = description
//  complète + recommandation. Même patron d'interaction que
//  <app-cve-table> (Trivy/OWASP), adapté à la forme des alertes ZAP
//  telle que normalisée par WF1 (id/risk/title/message/evidence/
//  recommendation — pas de package/CVSS/version ici).
//  Usage :
//    <app-zap-table [alerts]="enrichedData.zap.alerts"></app-zap-table>
// ─────────────────────────────────────────────────────────────────────

type RawZapAlert = any;

interface NormZapAlert {
  id: string;
  severity: string;
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
  url: string;
  param: string;
  reference: string;
  remediationLabel: string;
}

@Component({
  selector: 'app-zap-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="zap-wrap" *ngIf="normalized().length; else empty">
      <table class="zap-table">
        <thead>
          <tr><th style="width:32px"></th><th>Alerte</th><th>Risque</th><th>URL / cible</th></tr>
        </thead>
        <tbody>
          <ng-container *ngFor="let a of normalized()">
            <tr class="zap-row" [class.open]="isOpen(a.id)" (click)="toggle(a.id)">
              <td class="zap-caret">{{ isOpen(a.id) ? '▾' : '▸' }}</td>
              <td class="zap-title">{{ a.title }}</td>
              <td><span class="zap-sev" [attr.data-sev]="a.severity">{{ a.severity }}</span></td>
              <td class="zap-url">{{ a.url || 'Non disponible' }}</td>
            </tr>

            <tr *ngIf="isOpen(a.id)" class="zap-detail-row">
              <td colspan="4">
                <div class="zap-detail">

                  <div class="zap-block">
                    <h4>Description</h4>
                    <p [innerHTML]="a.description || 'Non disponible'"></p>
                  </div>

                  <div class="zap-block" *ngIf="a.evidence">
                    <h4>Preuve</h4>
                    <p [innerHTML]="a.evidence"></p>
                  </div>

                  <div class="zap-block zap-fix">
                    <h4>Solution recommandée</h4>
                    <p [innerHTML]="a.recommendation || 'Non disponible'"></p>
                  </div>

                  <div class="zap-owner" *ngIf="a.remediationLabel">🧑‍💻 {{ a.remediationLabel }}</div>

                  <div class="zap-meta">
                    <span><strong>Paramètre :</strong> {{ a.param || 'Non disponible' }}</span>
                    <span><strong>Référence :</strong> {{ a.reference || 'Non disponible' }}</span>
                    <span><strong>Identifiant :</strong> {{ a.id }}</span>
                  </div>
                </div>
              </td>
            </tr>
          </ng-container>
        </tbody>
      </table>
    </div>

    <ng-template #empty>
      <div class="zap-empty">
        <p>Aucune alerte DAST détectée sur ce build.</p>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display:block; font-size:13px; color:#1f2933; }

    .zap-table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; }
    .zap-table thead th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em;
                          color:#64748b; background:#f8fafc; padding:9px 12px; border-bottom:1px solid #e2e8f0; }
    .zap-row { cursor:pointer; border-bottom:1px solid #f1f5f9; transition:background .12s; }
    .zap-row:hover { background:#f8fafc; }
    .zap-row.open { background:#eff6ff; }
    .zap-row td { padding:9px 12px; }
    .zap-caret { color:#94a3b8; text-align:center; }
    .zap-title { font-weight:600; max-width:260px; }
    .zap-sev { font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; }
    .zap-sev[data-sev='HIGH']   { background:#fee2e2; color:#b91c1c; }
    .zap-sev[data-sev='MEDIUM'] { background:#fef9c3; color:#a16207; }
    .zap-sev[data-sev='LOW']    { background:#e0f2fe; color:#0369a1; }
    .zap-url { font-family:'JetBrains Mono', ui-monospace, monospace; font-size:11px; color:#64748b; word-break:break-all; }

    .zap-detail-row td { padding:0; background:#f8fafc; }
    .zap-detail { padding:14px 18px 18px; border-bottom:2px solid #e2e8f0; }
    .zap-block { margin-bottom:14px; }
    .zap-block h4 { margin:0 0 5px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#475569; }
    .zap-block p { margin:0; line-height:1.55; }
    .zap-fix p { color:#166534; }
    .zap-owner { display:inline-block; background:#fef3c7; color:#92400e; border-radius:6px; padding:4px 10px;
                 font-size:12px; font-weight:600; margin-bottom:10px; }
    .zap-meta { display:flex; gap:16px; flex-wrap:wrap; font-size:12px; color:#64748b; }

    .zap-empty { text-align:center; color:#64748b; padding:36px 20px; }
  `]
})
export class ZapTableComponent {
  @Input() set alerts(value: RawZapAlert[] | null | undefined) { this._raw.set(value ?? []); }

  private _raw = signal<RawZapAlert[]>([]);
  private openKeys = signal<Set<string>>(new Set());

  private sevRank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

  private stripHtml(v: string | null | undefined): string {
    return (v ?? '').replace(/<\/?[a-z][^>]*>/gi, '').trim();
  }

  normalized = computed<NormZapAlert[]>(() => {
    const out = this._raw().map((r: any, i: number): NormZapAlert => ({
      id: r.id ?? r.pluginid ?? r.alertRef ?? String(i),
      severity: String(r.severity ?? r.risk ?? 'UNKNOWN').toUpperCase().split(' ')[0],
      title: r.title ?? r.name ?? r.alert ?? 'Alerte sans titre',
      // description/evidence/recommendation viennent de WF1 avec des balises <p> --
      // rendues via [innerHTML] (Angular sanitize) plutôt que du texte brut avec
      // des chevrons visibles.
      description: r.description ?? r.desc ?? r.message ?? '',
      evidence: r.evidence ?? '',
      recommendation: r.recommendation ?? r.solution ?? '',
      url: r.url ?? '',
      param: r.param ?? r.parameter ?? '',
      reference: this.stripHtml(r.reference),
      remediationLabel: remediationTypeLabel(r.remediationType),
    }));
    return out.sort((a, b) => (this.sevRank[a.severity] ?? 9) - (this.sevRank[b.severity] ?? 9));
  });

  isOpen(id: string): boolean { return this.openKeys().has(id); }

  toggle(id: string): void {
    const next = new Set(this.openKeys());
    next.has(id) ? next.delete(id) : next.add(id);
    this.openKeys.set(next);
  }
}
