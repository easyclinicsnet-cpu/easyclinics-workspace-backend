import { DataSource } from 'typeorm';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { Supplier } from '../entities/supplier.entity';
import { QuerySupplierDto } from '../dtos/supplier';
import { IPaginatedResult } from '../interfaces';
import { INVENTORY_CONSTANTS } from '../constants';

export class SupplierRepository extends EncryptedRepository<Supplier> {
  constructor(
    dataSource: DataSource,
    aes256Service: Aes256Service,
    logger: LoggerService,
  ) {
    super(Supplier, dataSource, aes256Service, logger);
  }

  protected getSearchableEncryptedFields(): string[] {
    return ['name', 'email', 'phone', 'contactPerson'];
  }

  protected getSearchFilters(): Record<string, any> {
    return { isDeleted: false };
  }

  async findByWorkspace(
    workspaceId: string,
    query: QuerySupplierDto,
  ): Promise<IPaginatedResult<Supplier>> {
    const page = query.page || 1;
    const limit = query.limit || INVENTORY_CONSTANTS.DEFAULTS.PAGE_SIZE;
    const skip = (page - 1) * limit;

    const qb = this.dataSource.getRepository(Supplier)
      .createQueryBuilder('supplier')
      .where('supplier.workspaceId = :workspaceId', { workspaceId })
      .andWhere('supplier.isDeleted = false');

    if (query.search) {
      qb.andWhere(
        '(supplier.name LIKE :search OR supplier.code LIKE :search OR supplier.contactPerson LIKE :search)',
        { search: `%${query.search}%` },
      );
    }
    if (query.isActive !== undefined) qb.andWhere('supplier.isActive = :active', { active: query.isActive });

    const sortBy = query.sortBy || 'name';
    const sortOrder = query.sortOrder || 'ASC';
    qb.orderBy(`supplier.${sortBy}`, sortOrder);

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findByCode(workspaceId: string, code: string): Promise<Supplier | null> {
    return this.dataSource.getRepository(Supplier).findOne({
      where: { workspaceId, code, isDeleted: false },
    });
  }
}
