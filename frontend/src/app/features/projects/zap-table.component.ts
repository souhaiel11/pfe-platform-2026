import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FrenchDatePipe } from '../../shared/french-date.pipe';
import { remediationTypeLabel } from '../../shared/status-labels';
import { PresentationLabelPipe } from '../../shared/presentation-label.pipe';

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
  imports: [CommonModule, FormsModule, FrenchDatePipe, PresentationLabelPipe],
  template: `
    <div class="zap-wrap" *ngIf="normalized().length; else empty">
      <table class="zap-table">
        <thead>
          <tr><th style="width:58px">Détail</th><th>Alerte</th><th>Risque</th><th>URL / cible</th></tr>
        </thead>
        <tbody>
          <ng-container *ngFor="let a of filtered()">
            <tr class="zap-row" [class.open]="isOpen(a.id)" (click)="toggle(a.id)">
              <td class="zap-caret">{{ isOpen(a.id) ? '▾' : '▸' }}</td>
              <td class="zap-title">{{ a.title }}</td>
              <td><span class="zap-sev" [attr.data-sev]="a.severity">{{ a.severity | presentationLabel }}</span></td>
              <td class="zap-url">{{ a.url || 'Non disponible' }}</td>
            </tr>

            <tr *ngIf="isOpen(a.id)" class="zap-detail-row">
              <td colspan="4">
                <div class="zap-detail">

                  <div class="zap-block">
                    <h4>Description technique du scanner</h4>
                    <p [innerHTML]="a.description || 'Non disponible'"></p>
                  </div>

                  <div class="zap-block" *ngIf="a.evidence">
                    <h4>Preuve technique</h4>
                    <p [innerHTML]="a.evidence"></p>
                  </div>

                  <div class="zap-block zap-fix">
                    <h4>Correction recommandée</h4>
                    <p [innerHTML]="a.recommendation || 'Non disponible'"></p>
                  </div>

                  <div class="zap-owner" *ngIf="a.remediationLabel">🧑‍💻 {{ a.remediationLabel }}</div>

                  <div class="zap-meta">
                    <span *ngIf="a.param"><strong>Paramètre :</strong> {{ a.param }}</span>
                    <span *ngIf="a.reference"><strong>Référence :</strong> {{ a.reference }}</span>
                    <span><strong>Identifiant :</strong> {{ a.id }}</span>
                  </div>
                  <section class="tracking" *ngIf="taskFor(a) as task">
                    <h4>Suivi du traitement</h4>
                    <button *ngIf="(task.status === 'TODO' || task.status === 'REOPENED') && canComplete(task)" type="button" class="track-btn" (click)="$event.stopPropagation(); openConfirmation(task, a)">☐ Marquer comme traité</button><span *ngIf="(task.status === 'TODO' || task.status === 'REOPENED') && !canComplete(task)">Lecture seule</span>
                    <ng-container *ngIf="task.status === 'DONE_BY_USER' || task.status === 'VERIFIED'">
                      <p class="done">✓ {{task.status === 'VERIFIED' ? 'Vérifié' : 'Traité manuellement'}}</p><p><strong>Traité par :</strong> {{task.completedByDisplayName || 'Non disponible'}}</p><p><strong>Date du traitement :</strong> {{task.completedAt | frenchDate}}</p><p *ngIf="task.completionNote"><strong>Note de traitement :</strong> {{task.completionNote}}</p><p><strong>Dernière détection :</strong> {{task.lastSeenBuild ? 'build #' + task.lastSeenBuild : 'Non disponible'}}</p><p *ngIf="task.verifiedBuild"><strong>Vérifié au build :</strong> #{{task.verifiedBuild}}</p>
                      <button *ngIf="task.status !== 'VERIFIED' && userRole === 'admin'" type="button" class="reopen-btn" (click)="$event.stopPropagation(); reopenTask.emit(task)">Rouvrir la tâche</button>
                    </ng-container>
                    <p><strong>Analyse :</strong> {{scannerLabel(task)}} · <strong>État du traitement :</strong> {{task.status === 'VERIFIED' ? 'Vérifié' : (task.status === 'DONE_BY_USER' ? 'À vérifier' : 'Action requise')}}</p>
                  </section>
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
    <div class="confirm-backdrop" *ngIf="pendingTask()" (click)="cancelConfirmation()"><section class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="zap-confirm-title" (click)="$event.stopPropagation()"><h3 id="zap-confirm-title">Confirmer le traitement</h3><p><strong>Problème :</strong> {{pendingFinding()?.title}}</p><p><strong>Source :</strong> ZAP</p><p>Cette action signifie uniquement que vous avez effectué le traitement manuel.</p><p>La résolution technique sera confirmée lors d'une prochaine analyse.</p><label>Note de traitement (facultative)<textarea maxlength="500" [(ngModel)]="completionNote"></textarea></label><div class="confirm-actions"><button type="button" (click)="cancelConfirmation()">Annuler</button><button type="button" class="track-btn" (click)="confirmCompletion()">Confirmer</button></div></section></div>
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
    .tracking{margin-top:14px;padding:13px;background:#fff;border:1px solid #cbd5e1;border-radius:8px}.tracking p{margin:6px 0}.done{color:#15803d;font-weight:700}.track-btn{border:0;border-radius:7px;background:#2563eb;color:#fff;padding:8px 12px;font-weight:700;cursor:pointer}.reopen-btn{border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:7px 10px}.confirm-backdrop{position:fixed;inset:0;background:#0f172a99;display:flex;align-items:center;justify-content:center;z-index:1200;padding:20px}.confirm-box{max-width:520px;width:100%;background:#fff;border-radius:12px;padding:22px}.confirm-box h3{margin-top:0}.confirm-box label{display:grid;gap:6px;font-weight:600}.confirm-box textarea{min-height:75px;padding:8px;border:1px solid #cbd5e1;border-radius:7px}.confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
  `]
})
export class ZapTableComponent {
  @Input() set alerts(value: RawZapAlert[] | null | undefined) { this._raw.set(value ?? []); }
  @Input() tasks: any[] = [];
  @Input() statusFilter = 'ALL'; @Input() severityFilter = 'ALL'; @Input() userRole = 'viewer';
  @Output() completeTask = new EventEmitter<{ task: any; note?: string }>();
  @Output() reopenTask = new EventEmitter<any>();
  pendingTask = signal<any>(null); pendingFinding = signal<NormZapAlert | null>(null); completionNote = '';

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
  filtered(): NormZapAlert[] { return this.normalized().filter(a => { const task = this.taskFor(a); return (this.severityFilter === 'ALL' || a.severity === this.severityFilter) && (this.statusFilter === 'ALL' || (this.statusFilter === 'STILL_DETECTED' ? task?.scannerStatus === 'STILL_DETECTED' : task?.status === this.statusFilter)); }); }

  isOpen(id: string): boolean { return this.openKeys().has(id); }

  toggle(id: string): void {
    const next = new Set(this.openKeys());
    next.has(id) ? next.delete(id) : next.add(id);
    this.openKeys.set(next);
  }
  taskFor(a: NormZapAlert): any { return this.tasks.find(t => t.source === 'ZAP' && String(t.findingSnapshot?.ruleOrCve).toLowerCase() === a.id.toLowerCase() && String(t.findingSnapshot?.url || '').replace(/\/$/, '').toLowerCase() === String(a.url || '').replace(/\/$/, '').toLowerCase() && String(t.findingSnapshot?.parameter || '').toLowerCase() === a.param.toLowerCase()); }
  canComplete(task: any): boolean { return this.userRole === 'admin' || (this.userRole === 'developer' && task.remediationType !== 'ADMIN_ACTION_REQUIRED'); }
  scannerLabel(task: any): string { return task.scannerStatus === 'NOT_DETECTED' ? 'Non détecté' : task.scannerStatus === 'UNAVAILABLE' ? 'Analyse indisponible' : task.scannerStatus === 'STILL_DETECTED' ? `Toujours détecté${task.lastSeenBuild ? ' au build #' + task.lastSeenBuild : ''}` : 'Détecté'; }
  openConfirmation(task: any, finding: NormZapAlert) { this.pendingTask.set(task); this.pendingFinding.set(finding); this.completionNote = ''; }
  cancelConfirmation() { this.pendingTask.set(null); this.pendingFinding.set(null); this.completionNote = ''; }
  confirmCompletion() { const task = this.pendingTask(); if (task) this.completeTask.emit({ task, note: this.completionNote }); this.cancelConfirmation(); }
}
