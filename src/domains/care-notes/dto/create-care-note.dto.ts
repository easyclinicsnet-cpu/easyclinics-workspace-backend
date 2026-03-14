import {
  IsUUID,
  IsEnum,
  IsObject,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CareNoteType, CareNoteStatus } from '../../../common/enums';

/**
 * CareNoteContentDto
 *
 * Kept for documentation only. The `content` field on CreateCareNoteDto
 * intentionally does NOT use @ValidateNested so the global
 * forbidNonWhitelisted pipe does not reject frontend-defined fields (history,
 * examination, treatmentPlan, vitals, etc.) that vary per note type.
 * The full schema for each note type is in note-content.interface.ts.
 */
export class CareNoteContentDto {
  @IsOptional()
  chiefComplaint?: string;

  @IsOptional()
  historyOfPresentIllness?: string;

  @IsOptional()
  reviewOfSystems?: string;

  @IsOptional()
  physicalExamination?: string;

  @IsOptional()
  assessment?: string;

  @IsOptional()
  diagnosis?: string;

  @IsOptional()
  plan?: string;

  @IsOptional()
  medications?: any[];

  @IsOptional()
  procedures?: any[];

  @IsOptional()
  followUp?: string;

  [key: string]: any; // All additional fields accepted — no nested whitelist enforced
}

export class AiMetadataDto {
  @IsOptional()
  provider?: string;

  @IsOptional()
  model?: string;

  @IsOptional()
  temperature?: number;

  @IsOptional()
  tokensUsed?: number;

  @IsOptional()
  transcriptId?: string;

  [key: string]: any;
}

export class CreateCareNoteDto {
  @IsUUID()
  consultationId: string;

  @IsEnum(CareNoteType)
  type: CareNoteType;

  /**
   * Free-form clinical note content (structure varies by note type).
   * Validated as a non-empty object only — no nested property whitelist enforced,
   * because each of the 10 note types has a different content schema.
   * See note-content.interface.ts for per-type schemas.
   */
  @IsNotEmpty()
  @IsObject()
  content: Record<string, any>;

  @IsOptional()
  @IsEnum(CareNoteStatus)
  status?: CareNoteStatus = CareNoteStatus.DRAFT;

  @IsOptional()
  @IsBoolean()
  isAiGenerated?: boolean = false;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AiMetadataDto)
  aiMetadata?: AiMetadataDto;
}
