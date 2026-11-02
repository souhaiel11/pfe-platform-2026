/** Vérifie auprès de GitHub et n8n (jamais à partir d'une donnée fournie par l'appelant) qu'un groupe legacy est réellement figé avant archivage. */
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { legacyCatalog, legacyDigest } from './legacy-reconciliation';
@Injectable()
export class LegacyRemoteSettlement {
  /** Appel GET générique vers une API distante (GitHub ou n8n), avec timeout et refus explicite sur toute erreur. */
  private async get(url: string, headers: Record<string,string> = {}) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json', ...headers }, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!r.ok) throw new Error('remote unavailable');
      return await r.json();
    } catch { throw new ServiceUnavailableException('LEGACY_REMOTE_SETTLEMENT_UNVERIFIABLE'); }
  }
  /** Pagine l'intégralité d'un endpoint GitHub (100 par page, 10 pages max) ; refuse si la liste semble tronquée. */
  private async pages(path: string): Promise<any[]> {
    const values: any[] = [];
    for (let page = 1; page <= 10; page++) {
      const rows = await this.get(`https://api.github.com/repos/${legacyCatalog.repository}/${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new ConflictException('LEGACY_REMOTE_INVENTORY_AMBIGUOUS');
      values.push(...rows); if (rows.length < 100) return values;
    }
    throw new ConflictException('LEGACY_REMOTE_INVENTORY_INCOMPLETE');
  }
  /** Vérifie, à partir de l'état réel de GitHub et de n8n, qu'un groupe legacy est figé avant archivage. */
  async verify(groupId: string, groupDigest: string, operatorId: string) {
    let receipt: any;
    try {
      const path = process.env.SECURITY_LEGACY_SETTLEMENT_RECEIPTS_FILE;
      if (!path || !path.startsWith('/')) throw new Error();
      const raw = readFileSync(path, 'utf8'); if (raw.length > 1000000) throw new Error();
      receipt = JSON.parse(raw).receipts?.find((r: any) => r.groupId === groupId && r.groupDigest === groupDigest);
    } catch { throw new ConflictException('LEGACY_OPERATOR_SETTLEMENT_RECEIPT_REQUIRED'); }
    const age = Date.now() - Date.parse(receipt?.reviewedAt);
    if (!receipt || receipt.repository !== legacyCatalog.repository || receipt.targetFile !== 'pom.xml' ||
        receipt.approvedBy !== operatorId || !receipt.evidenceReference || receipt.unrecordedEffectsReviewed !== true ||
        receipt.writerFreezeConfirmed !== true || !Number.isFinite(age) || age < 0 || age > 15 * 60_000 ||
        !Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= Date.now() || Date.parse(receipt.expiresAt) - Date.parse(receipt.reviewedAt) > 15 * 60_000)
      throw new ConflictException('LEGACY_OPERATOR_SETTLEMENT_RECEIPT_INVALID');
    if (process.env.SECURITY_REMEDIATION_DISPATCH_ENABLED?.trim().toLowerCase() !== 'false')
      throw new ConflictException('LEGACY_RECONCILIATION_REQUIRES_DISPATCH_FREEZE');
    const api = process.env.N8N_API_URL || process.env.N8N_URL;
    const key = process.env.N8N_API_KEY;
    if (!api || !key) throw new ServiceUnavailableException('LEGACY_EXECUTION_QUIESCENCE_UNVERIFIABLE');
    const base = new URL(api); if (!['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
      throw new ConflictException('LEGACY_EXECUTION_API_INVALID');
    const executions: any[] = []; let cursor: string | undefined;
    for (let page=0; page<10; page++) {
      const result = await this.get(`${api.replace(/\/$/,'')}/api/v1/executions?limit=250${cursor ? '&cursor='+encodeURIComponent(cursor) : ''}`, { 'X-N8N-API-KEY': key });
      if (!Array.isArray(result.data)) throw new ConflictException('LEGACY_EXECUTION_INVENTORY_AMBIGUOUS');
      if (result.data.some(e => !e || typeof e.workflowId !== 'string' || typeof e.status !== 'string')) throw new ConflictException('LEGACY_EXECUTION_INVENTORY_AMBIGUOUS');
      executions.push(...result.data); cursor=result.nextCursor;
      if (!cursor) break;
      if (page === 9) throw new ConflictException('LEGACY_EXECUTION_INVENTORY_INCOMPLETE');
    }
    if (executions.some(e => e.workflowId === 'RdYyfjVpOm2LxS95' && !['success','error','canceled','crashed'].includes(e.status)))
      throw new ConflictException('LEGACY_REMOTE_WRITER_NOT_QUIESCENT');
    const [prs, branches] = await Promise.all([this.pages('pulls?state=all'), this.pages('branches')]);
    if (branches.some(b => typeof b.name !== 'string' || !/^[a-f0-9]{40}$/i.test(b.commit?.sha || '') || b.name.startsWith('security/fix/')) ||
        prs.some(p => !p.head?.ref || !['open','closed'].includes(p.state) || (p.state === 'open' && p.head.ref.startsWith('security/fix/'))))
      throw new ConflictException('LEGACY_REMOTE_WRITER_NOT_SETTLED');
    const known = legacyCatalog.remoteReferences;
    const references = known.map(ref => {
      const pr = prs.find(p => p.number === ref.prNumber);
      if (!pr || pr.state !== 'closed' || pr.head?.sha !== ref.headSha || pr.head?.ref !== ref.branch || !pr.closed_at ||
          !Object.prototype.hasOwnProperty.call(pr,'merged_at')) throw new ConflictException('LEGACY_REMOTE_REFERENCE_MISSING_DRIFTED_OR_AMBIGUOUS');
      return { prNumber: pr.number, headSha: pr.head.sha, state: pr.merged_at ? 'MERGED' : 'CLOSED_UNMERGED', branch: 'MISSING' };
    });
    const inventory = { references, branches: branches.map(b => ({ name:b.name, sha:b.commit?.sha })).sort((a,b)=>a.name.localeCompare(b.name)) };
    if (legacyDigest(inventory) !== receipt.inventoryDigest) throw new ConflictException('LEGACY_REVIEWED_REMOTE_INVENTORY_DRIFTED');
    return { ...receipt, verifiedAt: new Date().toISOString(), remoteInventory: inventory };
  }
}
