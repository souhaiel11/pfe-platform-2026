// DTOs : les seuls champs qu'un appelant peut fournir à POST /azure-deploy/artifacts/register.
import { IsInt, IsOptional, IsString, IsUUID, IsUrl, Matches, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const IMAGE_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const REPOSITORY_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,254}$/;

export class ArtifactPushReceiptDto {
  @IsString()
  @Matches(/^sha256:[a-f0-9]{64}$/i, { message: 'pushReceipt.manifestDigest doit être le digest de MANIFESTE sha256:<64 hex> imprimé par docker push.' })
  manifestDigest: string;

  @IsInt()
  @Min(1)
  buildNumber: number;

  @IsUrl({ require_tld: false, require_protocol: true }, { message: 'pushReceipt.jenkinsBuildUrl doit être une URL absolue.' })
  jenkinsBuildUrl: string;
}

export class RegisterArtifactDto {
  @IsUUID()
  projectId: string;

  @IsInt()
  @Min(1)
  buildNumber: number;

  @IsString()
  @Matches(/^[a-f0-9]{40}$/i, { message: 'commitSha doit être un sha-1 git complet (40 caractères hexadécimaux).' })
  commitSha: string;

  @IsString()
  @Matches(REPOSITORY_PATTERN)
  repository: string;

  @IsString()
  @Matches(IMAGE_TAG_PATTERN)
  tag: string;

  @IsOptional()
  @IsString()
  @Matches(/^sha256:[a-f0-9]{64}$/i, { message: 'digest doit être sha256:<64 caractères hexadécimaux>.' })
  digest?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ArtifactPushReceiptDto)
  pushReceipt?: ArtifactPushReceiptDto;
}
