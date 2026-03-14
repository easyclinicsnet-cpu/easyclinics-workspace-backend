import { InventoryCategory } from '../../entities/inventory-category.entity';
import { ItemType } from '../../../../common/enums';
import { IStorageConditions } from '../../interfaces';

export class CategoryResponseDto {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  description?: string;
  defaultUnit?: string;
  parentId?: string;
  type: ItemType;
  storageConditions?: IStorageConditions;
  requiresPrescriptionDefault: boolean;
  isControlledDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  children?: CategoryResponseDto[];

  static fromEntity(entity: InventoryCategory): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = entity.id;
    dto.workspaceId = entity.workspaceId;
    dto.code = entity.code;
    dto.name = entity.name;
    dto.description = entity.description;
    dto.defaultUnit = entity.defaultUnit;
    dto.parentId = entity.parentId;
    dto.type = entity.type;
    dto.storageConditions = entity.storageConditions;
    dto.requiresPrescriptionDefault = entity.requiresPrescriptionDefault;
    dto.isControlledDefault = entity.isControlledDefault;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt?.toISOString();
    dto.updatedAt = entity.updatedAt?.toISOString();
    if (entity.children) {
      dto.children = entity.children.map(CategoryResponseDto.fromEntity);
    }
    return dto;
  }
}
