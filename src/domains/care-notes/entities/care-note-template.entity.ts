import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { TemplateCategory, CareNoteType } from '../../../common/enums';
import { IsUUID } from 'class-validator';

/**
 * Care Note Template Entity
 * Predefined templates for different types of care notes
 */
@Entity('care_note_templates')
@Index('IDX_care_note_templates_workspace', ['workspaceId'])
@Index('IDX_care_note_templates_workspace_category', ['workspaceId', 'category'])
@Index('IDX_care_note_templates_workspace_note_type', ['workspaceId', 'noteType'])
@Index('IDX_care_note_templates_workspace_created_by', ['workspaceId', 'createdBy'])
@Index('IDX_care_note_templates_workspace_public', ['workspaceId', 'isPublic'])
@Index('IDX_care_note_templates_workspace_default', ['workspaceId', 'isDefault'])
@Index('IDX_care_note_templates_category', ['category'])
@Index('IDX_care_note_templates_note_type', ['noteType'])
@Index('IDX_care_note_templates_created_by', ['createdBy'])
@Index('IDX_care_note_templates_is_public', ['isPublic'])
@Index('IDX_care_note_templates_is_default', ['isDefault'])
@Index('IDX_care_note_templates_created_at', ['createdAt'])
@Index('IDX_care_note_templates_deleted_at', ['deletedAt'])
export class CareNoteTemplate extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({
    type: 'enum',
    enum: TemplateCategory,
    default: TemplateCategory.GENERAL,
  })
  category: TemplateCategory;

  @Column({
    type: 'enum',
    enum: CareNoteType,
    nullable: true,
  })
  noteType?: CareNoteType;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'longtext',
    nullable: true,
    transformer: {
      to: (value: any) => (value ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      },
    },
  })
  structure?: any;

  @Column({ type: 'varchar', length: 255 })
  createdBy: string;

  @Column({ type: 'boolean', default: true })
  isPublic: boolean;

  @Column({ type: 'boolean', default: true })
  isDefault: boolean;

  @Column({ type: 'int', default: 0 })
  usageCount: number;

  // ===== MULTI-TENANCY =====
  @Column({ type: 'varchar', length: 255, nullable: false })
  @IsUUID()
  workspaceId!: string;


  @Column({ type: 'boolean', default: false, nullable: true })
  isSystem?: boolean;
  @Column({ type: 'varchar', length: 255, nullable: true })
  deleted_by?: string;
}
