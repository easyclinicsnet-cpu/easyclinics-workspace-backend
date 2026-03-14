import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPatientNameToTranscriptionJobs1740700000010
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`transcription_jobs\`
        ADD COLUMN \`patientName\` varchar(200) DEFAULT NULL
        AFTER \`consultationId\`
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`transcription_jobs\`
        DROP COLUMN \`patientName\`
    `);
  }
}
