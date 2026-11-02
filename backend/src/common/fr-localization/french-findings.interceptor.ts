/** Francise les constats de scanners dans les réponses destinées à l'interface (requêtes authentifiées par un jeton utilisateur). */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { localizeFindingsFr } from './fr-findings';

@Injectable()
export class FrenchFindingsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    // Seuls les appels de l'interface (jeton utilisateur) sont traduits ; les appels internes
    // (n8n, Jenkins, secret partagé) reçoivent les données d'origine des scanners.
    const userCall = /^Bearer\s+/i.test(String(request?.headers?.authorization || ''));
    const internal = /\/(internal|webhooks?)(\/|$)/i.test(String(request?.originalUrl || request?.url || ''));
    if (!userCall || internal) return next.handle();
    // Fichiers et flux (rapports téléchargés, StreamableFile…) sont transmis tels quels.
    return next.handle().pipe(map(body => body instanceof StreamableFile || Buffer.isBuffer(body)
      || typeof (body as any)?.pipe === 'function' ? body : localizeFindingsFr(body)));
  }
}
