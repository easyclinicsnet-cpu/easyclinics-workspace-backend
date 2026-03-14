import { CareNoteType, CareNoteStatus, PermissionLevel } from '../../../common/enums';

export class CareNoteResponseDto {
  id: string;
  workspaceId: string;
  consultationId: string;
  type: CareNoteType;
  content: any;
  status: CareNoteStatus;
  isAiGenerated: boolean;
  aiMetadata?: any;
  authorId: string;
  versionNumber: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;

  // Relations
  consultation?: any;

  /**
   * The edited structuredTranscript (or manual content) that was actually
   * sent to the AI for note generation.
   *
   * Resolution order:
   *  1. aiMetadata.sourceTranscript — immutable snapshot (new notes)
   *  2. CareAiNoteSource.sourceContent — legacy / manual-content notes
   */
  structuredTranscript?: any;

  // Computed fields
  hasPermission?: boolean;
  userPermissionLevel?: PermissionLevel | null;
}
