import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../../common/logger/logger.service';
import { AuditLogService } from '../../../audit/services/audit-log.service';
import { MedicationItem } from '../../entities/medication-item.entity';
import { ConsumableItem } from '../../entities/consumable-item.entity';
import { MedicationAdjustment } from '../../entities/medication-adjustment.entity';
import { ConsumableAdjustment } from '../../entities/consumable-adjustment.entity';
import { Batch } from '../../entities/batch.entity';
import { IAdjustmentData } from '../../interfaces';
import { ItemType, AdjustmentType, AuditEventType, AuditOutcome } from '../../../../common/enums';

@Injectable()
export class AdjustmentStrategyContext {
  private readonly context = AdjustmentStrategyContext.name;

  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async adjust(data: IAdjustmentData): Promise<void> {
    this.logger.log('Processing inventory adjustment', { context: this.context, itemId: data.itemId, type: data.adjustmentType, quantity: data.quantity });

    const isAdditive = [AdjustmentType.ADD, AdjustmentType.RETURN].includes(data.adjustmentType);
    const quantityDelta = isAdditive ? data.quantity : -data.quantity;

    await this.dataSource.transaction(async (manager) => {
      // Record adjustment
      if (data.itemType === ItemType.MEDICATION) {
        await manager.save(MedicationAdjustment, manager.create(MedicationAdjustment, {
          workspaceId: data.workspaceId,
          medicationItemId: data.itemId,
          batchId: data.batchId,
          quantity: data.quantity,
          adjustmentType: data.adjustmentType,
          reason: data.reason,
          initiatedBy: data.initiatedBy,
          approvedBy: data.approvedBy,
          metadata: data.metadata,
        }));

        // Update item stock
        await manager.query(
          `UPDATE medication_items SET availableQuantity = availableQuantity + ?, totalQuantity = totalQuantity + ? WHERE id = ?`,
          [quantityDelta, quantityDelta, data.itemId],
        );
      } else {
        await manager.save(ConsumableAdjustment, manager.create(ConsumableAdjustment, {
          workspaceId: data.workspaceId,
          consumableItemId: data.itemId,
          batchId: data.batchId,
          quantity: data.quantity,
          adjustmentType: data.adjustmentType,
          reason: data.reason,
          initiatedBy: data.initiatedBy,
          approvedBy: data.approvedBy,
          metadata: data.metadata,
        }));

        await manager.query(
          `UPDATE consumable_items SET availableQuantity = availableQuantity + ?, totalQuantity = totalQuantity + ? WHERE id = ?`,
          [quantityDelta, quantityDelta, data.itemId],
        );
      }

      // Update batch if specified
      if (data.batchId) {
        await manager.query(
          `UPDATE batches SET availableQuantity = availableQuantity + ? WHERE id = ?`,
          [quantityDelta, data.batchId],
        );
      }
    });

    // Audit
    try {
      await this.auditLogService.log({
        workspaceId: data.workspaceId,
        userId: data.initiatedBy,
        action: `Inventory adjustment: ${data.adjustmentType} ${data.quantity} for item ${data.itemId}`,
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: data.itemType === ItemType.MEDICATION ? 'MedicationItem' : 'ConsumableItem',
        resourceId: data.itemId,
        newState: { adjustmentType: data.adjustmentType, quantity: data.quantity, reason: data.reason },
      });
    } catch (e) {
      this.logger.warn('Audit log failed for adjustment', this.context);
    }
  }
}
