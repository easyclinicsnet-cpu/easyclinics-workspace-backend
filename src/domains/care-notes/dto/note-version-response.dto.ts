export class NoteVersionResponseDto {
  id: string;
  workspaceId: string;
  noteId: string;
  versionNumber: number;
  content: any;
  changedById: string;
  changeReason?: string;
  createdAt: Date;

  // Relations
  note?: any;
  changedBy?: any;
}
