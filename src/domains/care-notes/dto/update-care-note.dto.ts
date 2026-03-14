import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { CareNoteStatus } from '../../../common/enums';

export class UpdateCareNoteDto {
  /**
   * Free-form clinical note content (structure varies by note type).
   * Validated as a JSON object only — no nested property whitelist enforced,
   * because each of the 10 note types has a different content schema.
   */
  @IsOptional()
  @IsObject()
  content?: Record<string, any>;

  @IsOptional()
  @IsEnum(CareNoteStatus)
  status?: CareNoteStatus;
}
