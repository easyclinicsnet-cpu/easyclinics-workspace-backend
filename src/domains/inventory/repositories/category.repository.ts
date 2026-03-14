import { DataSource, TreeRepository } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { InventoryCategory } from '../entities/inventory-category.entity';
import { QueryCategoryDto } from '../dtos/category';
import { IPaginatedResult } from '../interfaces';
import { INVENTORY_CONSTANTS } from '../constants';

export class CategoryRepository {
  private readonly repo: TreeRepository<InventoryCategory>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.repo = this.dataSource.getTreeRepository(InventoryCategory);
  }

  async findByWorkspace(
    workspaceId: string,
    query: QueryCategoryDto,
  ): Promise<IPaginatedResult<InventoryCategory>> {
    const page = query.page || 1;
    const limit = query.limit || INVENTORY_CONSTANTS.DEFAULTS.PAGE_SIZE;
    const skip = (page - 1) * limit;

    const qb = this.dataSource.getRepository(InventoryCategory)
      .createQueryBuilder('cat')
      .where('cat.workspaceId = :workspaceId', { workspaceId })
      .andWhere('cat.isDeleted = false');

    if (query.search) {
      qb.andWhere('(cat.name LIKE :search OR cat.code LIKE :search)', { search: `%${query.search}%` });
    }
    if (query.type) qb.andWhere('cat.type = :type', { type: query.type });
    if (query.parentId) qb.andWhere('cat.parentId = :parentId', { parentId: query.parentId });
    if (query.isActive !== undefined) qb.andWhere('cat.isActive = :active', { active: query.isActive });

    const sortBy = query.sortBy || 'name';
    const sortOrder = query.sortOrder || 'ASC';
    qb.orderBy(`cat.${sortBy}`, sortOrder);

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findByCode(workspaceId: string, code: string): Promise<InventoryCategory | null> {
    return this.dataSource.getRepository(InventoryCategory).findOne({
      where: { workspaceId, code, isDeleted: false },
    });
  }

  async findById(workspaceId: string, id: string): Promise<InventoryCategory | null> {
    return this.dataSource.getRepository(InventoryCategory).findOne({
      where: { id, workspaceId, isDeleted: false },
    });
  }

  async findTree(workspaceId: string): Promise<InventoryCategory[]> {
    const roots = await this.dataSource.getRepository(InventoryCategory).find({
      where: { workspaceId, parentId: undefined as any, isDeleted: false },
    });
    const result: InventoryCategory[] = [];
    for (const root of roots) {
      const tree = await this.repo.findDescendantsTree(root);
      result.push(tree);
    }
    return result;
  }

  async save(entity: InventoryCategory): Promise<InventoryCategory> {
    return this.dataSource.getRepository(InventoryCategory).save(entity);
  }

  async create(data: Partial<InventoryCategory>): Promise<InventoryCategory> {
    const entity = this.dataSource.getRepository(InventoryCategory).create(data);
    return this.save(entity);
  }
}
