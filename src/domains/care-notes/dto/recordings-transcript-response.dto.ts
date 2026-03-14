import { AIProvider } from '../../../common/enums';

export class RecordingsTranscriptResponseDto {
  id: string;
  workspaceId: string;
  consultationId: string;
  doctorId: string;
  audioFilePath?: string;
  audioFileSize?: number;
  audioFileDuration?: number;
  transcribedText: string;
  provider: AIProvider;
  model: string;
  language: string;
  confidence?: number;
  processingTimeMs?: number;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;

  // Relations
  consultation?: any;
  doctor?: any;
  generatedNotes?: any[];
}
