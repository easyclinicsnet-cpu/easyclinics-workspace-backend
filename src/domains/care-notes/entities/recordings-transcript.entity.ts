import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { AIProvider } from '../../../common/enums';

/**
 * Recordings Transcript Entity
 * Stores audio transcripts from consultations
 */
@Entity('recordings_transcript')
@Index('IDX_recordings_transcript_workspace', ['workspaceId'])
@Index('IDX_recordings_transcript_workspace_doctor', ['workspaceId', 'doctorId'])
@Index('IDX_recordings_transcript_workspace_consultation', ['workspaceId', 'consultationId'])
@Index('IDX_recordings_transcript_workspace_provider', ['workspaceId', 'aiProvider'])
@Index('IDX_recordings_transcript_doctor', ['doctorId'])
@Index('IDX_recordings_transcript_consultation', ['consultationId'])
@Index('IDX_recordings_transcript_provider', ['aiProvider'])
@Index('IDX_recordings_transcript_created_at', ['createdAt'])
@Index('IDX_recordings_transcript_deleted_at', ['deletedAt'])
export class RecordingsTranscript extends BaseEntity {
  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  doctorId: string;

  @Column({ type: 'varchar', length: 255 })
  consultationId: string;

  @Column({ type: 'text' })
  transcribedText: string;

  @Column({ type: 'varchar', length: 255 })
  audioFilePath: string;

  @Column({ type: 'text' })
  structuredTranscript: string;

  @Column({
    type: 'enum',
    enum: AIProvider,
  })
  aiProvider: AIProvider;

  @Column({ type: 'varchar', length: 255 })
  modelUsed: string;
}
