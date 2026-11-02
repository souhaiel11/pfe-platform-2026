// DTO de mise à jour d'une intégration : tous les champs de création, rendus optionnels.
import { PartialType } from '@nestjs/mapped-types';
import { CreateIntegrationDto } from './create-integration.dto';

export class UpdateIntegrationDto extends PartialType(CreateIntegrationDto) {}
