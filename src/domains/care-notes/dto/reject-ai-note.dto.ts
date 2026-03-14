import { IsUUID, IsString, MinLength } from 'class-validator';

export class RejectAiNoteDto {
  @IsUUID()
  noteId: string;

  @IsUUID()
  rejectedBy: string;

  @IsString()
  @MinLength(1)
  reason: string;
}
