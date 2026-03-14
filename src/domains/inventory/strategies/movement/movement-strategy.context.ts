import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../../common/logger/logger.service';
import { MedicationMovement } from '../../entities/medication-movement.entity';
import { ConsumableMovement } from '../../entities/consumable-movement.entity';
import { IMovementData } from '../../interfaces';
import { ItemType } from '../../../../common/enums';
import { INBOUND_MOVEMENT_TYPES, OUTBOUND_MOVEMENT_TYPES } from '../../constants';

@Injectable()
export class MovementStrategyContext {
  private readonly context = MovementStrategyContext.name;

  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {}

  async recordMovement(data: IMovementData): Promise<void> {
    this.logger.log('Recording inventory movement', { context: this.context, itemId: data.itemId, type: data.movementType, quantity: data.quantity });

    if (data.itemType === ItemType.MEDICATION) {
      const movement = this.dataSource.getRepository(MedicationMovement).create({
        workspaceId: data.workspaceId,
        medicationItemId: data.itemId,
        batchId: data.batchId,
        quantity: data.quantity,
        type: data.movementType,
        movementType: data.movementType,
        department: data.department,
        reference: data.reference,
        initiatedBy: data.initiatedBy,
        metadata: data.metadata,
      });
      await this.dataSource.getRepository(MedicationMovement).save(movement);
    } else {
      const movement = this.dataSource.getRepository(ConsumableMovement).create({
        workspaceId: data.workspaceId,
        consumableItemId: data.itemId,
        batchId: data.batchId,
        quantity: data.quantity,
        type: data.movementType,
        movementType: data.movementType,
        department: data.department,
        reference: data.reference,
        initiatedBy: data.initiatedBy,
        metadata: data.metadata,
      });
      await this.dataSource.getRepository(ConsumableMovement).save(movement);
    }
  }

  getMovementDirection(movementType: string): number {
    if (INBOUND_MOVEMENT_TYPES.includes(movementType as any)) return 1;
    if (OUTBOUND_MOVEMENT_TYPES.includes(movementType as any)) return -1;
    return 0;
  }
}
