import { Exclude, Expose, Type } from 'class-transformer';
import { NoteAuditActionType } from '../../../common/enums';

/**
 * DTO for note audit log responses
 * Exposes all fields with proper transformations
 */
@Exclude()
export class NoteAuditLogResponseDto {
  @Expose()
  id: string;

  @Expose()
  noteId: string;

  @Expose()
  userId: string;

  @Expose()
  actionType: NoteAuditActionType;

  @Expose()
  changedFields?: string[];

  @Expose()
  previousValues?: Record<string, any>;

  @Expose()
  newValues?: Record<string, any>;

  @Expose()
  metadata?: Record<string, any>;

  @Expose()
  ipAddress?: string;

  @Expose()
  userAgent?: string;

  @Expose()
  comment?: string;

  @Expose()
  patientId?: string;

  @Expose()
  aiProvider?: string;

  @Expose()
  sharedWith?: string;

  @Expose()
  oldPermission?: string;

  @Expose()
  newPermission?: string;

  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @Expose()
  @Type(() => Date)
  updatedAt: Date;

  /** SHA-256 tamper-evidence hash for this record. */
  @Expose()
  hash?: string;

  /** Hash of the immediately preceding audit entry for this note ('GENESIS' for the first). */
  @Expose()
  previousHash?: string;
}
