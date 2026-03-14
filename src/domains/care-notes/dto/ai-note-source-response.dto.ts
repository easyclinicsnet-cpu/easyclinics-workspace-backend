import { AIProvider } from '../../../common/enums';

export class AiNoteSourceResponseDto {
  id: string;
  workspaceId: string;
  noteId: string;
  transcriptId?: string;
  provider: AIProvider;
  sourceType: string;
  sourceId?: string;
  sourceContent?: string;
  model: string;
  temperature: number;
  tokensUsed?: number;
  processingTimeMs?: number;
  modelVersion?: string;
  confidenceScore?: number;
  processedAt?: Date;
  processingMetadata?: any;
  recordingTranscriptId?: string;
  isApproved: boolean;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;

  // Relations
  note?: any;
  transcript?: any;
}
