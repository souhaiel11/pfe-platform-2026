// Définit la forme de modification d'un projet à partir du DTO de création ; les champs de mise à jour sont optionnels.
import { PartialType } from '@nestjs/mapped-types';
import { CreateProjectDto } from './create-project.dto';
export class UpdateProjectDto extends PartialType(CreateProjectDto) {}
