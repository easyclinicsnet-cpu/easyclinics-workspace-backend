import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { CareNoteTimeline } from '../entities/care-note-timeline.entity';

@Injectable()
export class NoteTimelineRepository extends Repository<CareNoteTimeline> {
  constructor(
    private dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(CareNoteTimeline, dataSource.createEntityManager());
    this.logger.setContext('NoteTimelineRepository');
  }

  async findByConsultation(
    consultationId: string,
    workspaceId: string,
  ): Promise<CareNoteTimeline[]> {
    this.logger.debug(
      `Finding timeline by consultation: ${consultationId}`,
    );

    return this.find({
      where: { consultationId, workspaceId },
      relations: ['note', 'note.author'],
      order: { sequenceNumber: 'ASC' },
    });
  }

  async getNextSequence(
    consultationId: string,
    workspaceId: string,
  ): Promise<number> {
    this.logger.debug(
      `Getting next sequence for consultation: ${consultationId}`,
    );

    const result = await this.findOne({
      where: { consultationId, workspaceId },
      order: { sequenceNumber: 'DESC' },
    });

    return result ? result.sequenceNumber + 1 : 1;
  }

  async reorderTimeline(
    consultationId: string,
    noteId: string,
    newSequence: number,
    workspaceId: string,
  ): Promise<void> {
    this.logger.debug(
      `Reordering timeline: consultation=${consultationId}, note=${noteId}, sequence=${newSequence}`,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Get current timeline item
      const currentItem = await queryRunner.manager.findOne(CareNoteTimeline, {
        where: { noteId, consultationId, workspaceId },
      });

      if (!currentItem) {
        throw new Error('Timeline item not found');
      }

      const oldSequence = currentItem.sequenceNumber;

      if (oldSequence === newSequence) {
        await queryRunner.commitTransaction();
        return;
      }

      // Update other items
      if (newSequence > oldSequence) {
        // Moving down: decrement items between old and new position
        await queryRunner.manager
          .createQueryBuilder()
          .update(CareNoteTimeline)
          .set({ sequenceNumber: () => 'sequenceNumber - 1' })
          .where('consultationId = :consultationId', { consultationId })
          .andWhere('workspaceId = :workspaceId', { workspaceId })
          .andWhere('sequenceNumber > :oldSequence', { oldSequence })
          .andWhere('sequenceNumber <= :newSequence', { newSequence })
          .execute();
      } else {
        // Moving up: increment items between new and old position
        await queryRunner.manager
          .createQueryBuilder()
          .update(CareNoteTimeline)
          .set({ sequenceNumber: () => 'sequenceNumber + 1' })
          .where('consultationId = :consultationId', { consultationId })
          .andWhere('workspaceId = :workspaceId', { workspaceId })
          .andWhere('sequenceNumber >= :newSequence', { newSequence })
          .andWhere('sequenceNumber < :oldSequence', { oldSequence })
          .execute();
      }

      // Update current item
      await queryRunner.manager.update(
        CareNoteTimeline,
        { id: currentItem.id },
        { sequenceNumber: newSequence },
      );

      await queryRunner.commitTransaction();
      this.logger.info('Timeline reordered successfully');
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to reorder timeline', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
