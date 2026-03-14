import { IsString, IsEnum, IsOptional, IsObject, IsUUID, IsArray } from 'class-validator';
import { NoteAuditActionType } from '../../../common/enums';

/**
 * DTO for creating note audit log entries
 * Used to track clinical note modifications and AI interactions
 */
export class CreateNoteAuditLogDto {
  @IsUUID()
  noteId: string;

  @IsString()
  userId: string;

  @IsEnum(NoteAuditActionType)
  actionType: NoteAuditActionType;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  changedFields?: string[];

  @IsObject()
  @IsOptional()
  previousValues?: Record<string, any>;

  @IsObject()
  @IsOptional()
  newValues?: Record<string, any>;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @IsString()
  @IsOptional()
  ipAddress?: string;

  @IsString()
  @IsOptional()
  userAgent?: string;

  @IsString()
  @IsOptional()
  comment?: string;

  @IsString()
  @IsOptional()
  patientId?: string;

  @IsString()
  @IsOptional()
  aiProvider?: string;

  @IsString()
  @IsOptional()
  sharedWith?: string;

  @IsString()
  @IsOptional()
  oldPermission?: string;

  @IsString()
  @IsOptional()
  newPermission?: string;
}
