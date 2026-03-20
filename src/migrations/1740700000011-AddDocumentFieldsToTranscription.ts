import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds document-related columns to transcription_jobs and recordings_transcript
 * tables to support PDF, DOCX, and image document extraction alongside audio
 * transcription.
 */
export class AddDocumentFieldsToTranscription1740700000011
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── transcription_jobs ──────────────────────────────────────────────────
    await queryRunner.addColumns('transcription_jobs', [
      new TableColumn({
        name: 'document_file_path',
        type: 'varchar',
        length: '500',
        isNullable: true,
      }),
      new TableColumn({
        name: 'document_file_size_bytes',
        type: 'bigint',
        unsigned: true,
        isNullable: true,
      }),
      new TableColumn({
        name: 'document_type',
        type: 'varchar',
        length: '20',
        isNullable: true,
        comment: 'pdf, docx, or image',
      }),
    ]);

    // ── recordings_transcript ───────────────────────────────────────────────
    await queryRunner.addColumns('recordings_transcript', [
      new TableColumn({
        name: 'document_file_path',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
      new TableColumn({
        name: 'document_type',
        type: 'varchar',
        length: '20',
        isNullable: true,
        comment: 'pdf, docx, or image',
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('recordings_transcript', 'document_type');
    await queryRunner.dropColumn('recordings_transcript', 'document_file_path');
    await queryRunner.dropColumn('transcription_jobs', 'document_type');
    await queryRunner.dropColumn('transcription_jobs', 'document_file_size_bytes');
    await queryRunner.dropColumn('transcription_jobs', 'document_file_path');
  }
}
