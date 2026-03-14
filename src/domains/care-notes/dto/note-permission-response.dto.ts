import { PermissionLevel } from '../../../common/enums';

export class NotePermissionResponseDto {
  id: string;
  workspaceId: string;
  noteId: string;
  userId: string;
  permissionLevel: PermissionLevel;
  expiresAt?: Date;
  reason?: string;
  grantedById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;

  // Relations
  note?: any;
  user?: any;
  grantedBy?: any;
}
