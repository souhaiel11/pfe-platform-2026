// DTO et helpers de validation pour la création/mise à jour d'un incident : liste blanche de champs
// autorisés, validation des métadonnées JSON fournies par l'utilisateur ou par n8n (WF1).
import { BadRequestException } from '@nestjs/common';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, validateSync } from 'class-validator';
import { IncidentStatus } from './incident.entity';

export class IncidentWriteDto {
  @IsOptional() @IsString() @MaxLength(128) projectId?: string;
  @IsOptional() @IsString() @MaxLength(1000) title?: string;
  @IsOptional() @IsString() @MaxLength(100000) description?: string;
  @IsOptional() @IsEnum(IncidentStatus) status?: IncidentStatus;
  @IsOptional() @IsString() @MaxLength(128) source?: string;
  @IsOptional() @IsObject() metadata?: Record<string, any>;
  @IsOptional() @IsString() @MaxLength(2048) prUrl?: string;
  @IsOptional() @IsString() @MaxLength(512) jenkinsJobName?: string;
  @IsOptional() @IsInt() @Min(1) buildNumber?: number;
  @IsOptional() @IsString() @MaxLength(100000) aiAnalysis?: string;
  @IsOptional() @IsString() @MaxLength(2000) errorReason?: string;
  @IsOptional() @IsString() @MaxLength(100000) errorDetail?: string;
  @IsOptional() @IsString() @MaxLength(1000) errorStep?: string;
}
/** Taille maximale (caractères JSON) des métadonnées d'un incident. */
export const METADATA_MAX_CHARS = 8_000_000;
const scalarFields = ['projectId', 'title', 'description', 'status', 'source', 'prUrl', 'jenkinsJobName', 'buildNumber', 'aiAnalysis', 'errorReason', 'errorDetail', 'errorStep'];
/** Valide et nettoie les métadonnées fournies par l'utilisateur : taille bornée, profondeur limitée, clés dangereuses interdites, champ réservé retiré. */
export function userMetadata(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('metadata doit être un objet JSON.');
  const encoded = JSON.stringify(value);
  // 8 Mo : l'analyse WF1 d'un vrai build embarque les constats Trivy + OWASP complets (1,23 Mo dès
  // 180 + 295 CVE). L'ancienne borne de 1 Mo faisait échouer en 400 l'enregistrement de tout build
  // dont les deux scanners fonctionnent, et l'incident restait sans analyse ni commit source.
  if (encoded.length > METADATA_MAX_CHARS) throw new BadRequestException('metadata est trop volumineux.');
  const copy = JSON.parse(encoded);
  /** Signale une erreur pour visit. */
  const visit = (obj: any, depth: number) => {
    if (depth > 32) throw new BadRequestException('metadata est trop imbriqué.');
    if (obj && typeof obj === 'object') for (const key of Object.keys(obj)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new BadRequestException('Clé metadata interdite.');
      visit(obj[key], depth + 1);
    }
  };
  visit(copy, 0);
  delete copy.fixRequest;
  return copy;
}
/** Filtre un patch d'incident reçu sur la liste blanche de champs autorisés, puis le valide contre le DTO avant de le renvoyer. */
export function sanitizeIncidentPatch(value: any): IncidentWriteDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Incident invalide.');
  const patch: any = {};
  for (const key of scalarFields) if (Object.prototype.hasOwnProperty.call(value, key)) patch[key] = value[key];
  if (Object.prototype.hasOwnProperty.call(value, 'metadata')) patch.metadata = userMetadata(value.metadata);
  const errors = validateSync(Object.assign(new IncidentWriteDto(), patch));
  if (errors.length) throw new BadRequestException('Champs incident invalides.');
  return patch;
}
