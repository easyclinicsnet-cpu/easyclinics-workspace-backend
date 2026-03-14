import { CareNoteType, TemplateCategory } from '../../../common/enums';

export class NoteTemplateResponseDto {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  category: TemplateCategory;
  noteType: CareNoteType;
  content: any;
  isPublic: boolean;
  isDefault: boolean;
  isSystem: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;

  // Relations
  creator?: any;
}
