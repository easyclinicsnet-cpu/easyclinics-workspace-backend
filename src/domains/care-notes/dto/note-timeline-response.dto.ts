export class NoteTimelineResponseDto {
  id: string;
  workspaceId: string;
  consultationId: string;
  noteId: string;
  eventType: string;
  sequenceNumber: number;
  createdAt: Date;

  // Relations
  consultation?: any;
  note?: any;
}
