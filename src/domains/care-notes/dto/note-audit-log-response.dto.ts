import { NoteAuditActionType } from '../../../common/enums';

export class NoteAuditLogResponseDto {
  id: string;
  workspaceId: string;
  noteId: string;
  userId: string;
  action: NoteAuditActionType;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;

  // Relations
  note?: any;
  user?: any;
}
