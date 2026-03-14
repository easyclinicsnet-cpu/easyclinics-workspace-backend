import { IsNull } from 'typeorm';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { NoteTemplateRepository } from '../repositories/note-template.repository';
import {
  CreateNoteTemplateDto,
  UpdateNoteTemplateDto,
  NoteTemplateQueryDto,
  NoteTemplateResponseDto,
  PaginatedResponseDto,
} from '../dto';
import {
  AuditEventType,
  AuditOutcome,
  NoteAuditActionType,
} from '../../../common/enums';

@Injectable()
export class NoteTemplateService {
  constructor(
    private readonly templateRepository: NoteTemplateRepository,
    private readonly auditLogService: AuditLogService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('NoteTemplateService');
  }

  async create(
    dto: CreateNoteTemplateDto,
    userId: string,
    workspaceId: string,
  ): Promise<NoteTemplateResponseDto> {
    this.logger.info(`Creating note template: ${dto.name}`);

    try {
      const template = this.templateRepository.create({
        ...dto,
        workspaceId,
        createdBy: userId,
        isSystem: false,
      });

      const saved = await this.templateRepository.save(template);

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.CREATE,
          entityType: 'NoteTemplate',
          entityId: saved.id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.CREATE,
            templateName: dto.name,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Note template created successfully: ${saved.id}`);
      return saved as any;
    } catch (error) {
      this.logger.error('Failed to create note template', error);
      throw error;
    }
  }

  async findAll(
    query: NoteTemplateQueryDto,
    userId: string,
    workspaceId: string,
  ): Promise<PaginatedResponseDto<NoteTemplateResponseDto>> {
    this.logger.debug('Finding all note templates with filters');

    try {
      const [templates, total] =
        await this.templateRepository.findWithFilters(query, workspaceId);

      // Filter: users can only see public templates or their own private templates
      const accessible = templates.filter(
        (t) => t.isPublic || t.createdBy === userId,
      );

      const data = accessible as any[];

      return new PaginatedResponseDto(
        data,
        accessible.length,
        query.page || 1,
        query.limit || 20,
      );
    } catch (error) {
      this.logger.error('Failed to find note templates', error);
      throw error;
    }
  }

  async findOne(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<NoteTemplateResponseDto> {
    this.logger.debug(`Finding note template: ${id}`);

    const template = await this.templateRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
      relations: ['creator'],
    });

    if (!template) {
      throw new NotFoundException('Note template not found');
    }

    // Check access: public templates or user's own templates
    if (!template.isPublic && template.createdBy !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return template as any;
  }

  async update(
    id: string,
    dto: UpdateNoteTemplateDto,
    userId: string,
    workspaceId: string,
  ): Promise<NoteTemplateResponseDto> {
    this.logger.info(`Updating note template: ${id}`);

    const template = await this.templateRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!template) {
      throw new NotFoundException('Note template not found');
    }

    // Only creator can update (unless it's a system template)
    if (template.isSystem) {
      throw new ForbiddenException('Cannot modify system templates');
    }

    if (template.createdBy !== userId) {
      throw new ForbiddenException('Only template creator can update');
    }

    try {
      Object.assign(template, dto);
      const updated = await this.templateRepository.save(template);

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.UPDATE,
          entityType: 'NoteTemplate',
          entityId: id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.UPDATE,
            changes: dto,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Note template updated successfully: ${id}`);
      return updated as any;
    } catch (error) {
      this.logger.error('Failed to update note template', error);
      throw error;
    }
  }

  async remove(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.info(`Deleting note template: ${id}`);

    const template = await this.templateRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!template) {
      throw new NotFoundException('Note template not found');
    }

    // Cannot delete system templates
    if (template.isSystem) {
      throw new ForbiddenException('Cannot delete system templates');
    }

    // Only creator can delete
    if (template.createdBy !== userId) {
      throw new ForbiddenException('Only template creator can delete');
    }

    try {
      await this.templateRepository.softDelete({ id, workspaceId });

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.DELETE,
          entityType: 'NoteTemplate',
          entityId: id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.DELETE,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Note template deleted successfully: ${id}`);
    } catch (error) {
      this.logger.error('Failed to delete note template', error);
      throw error;
    }
  }
}
