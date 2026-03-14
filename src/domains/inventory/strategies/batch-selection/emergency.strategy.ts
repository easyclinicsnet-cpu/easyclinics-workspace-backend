import { Batch } from '../../entities/batch.entity';
import { IBatchSelectionStrategy, IBatchSelectionCriteria, IBatchSelectionResult, IBatchSelectionItem, IEmergencyBatchSelectionCriteria } from '../../interfaces';

/**
 * Emergency Strategy
 * Overrides quality/expiry checks for authorized emergency dispensing
 */
export class EmergencyStrategy implements IBatchSelectionStrategy {
  select(
    batches: Batch[],
    requiredQuantity: number,
    criteria: IBatchSelectionCriteria,
  ): IBatchSelectionResult {
    const emergencyCriteria = criteria as IEmergencyBatchSelectionCriteria;

    const eligible = batches
      .filter((b) => {
        if (Number(b.availableQuantity) <= 0) return false;
        if (b.isQuarantined && !emergencyCriteria.overrideQuality) return false;
        if (new Date(b.expiryDate) < new Date() && !emergencyCriteria.overrideExpiry) return false;
        return true;
      })
      .sort((a, b) => Number(b.availableQuantity) - Number(a.availableQuantity));

    const items: IBatchSelectionItem[] = [];
    let remaining = requiredQuantity;
    let totalCost = 0;
    const warnings: string[] = [];

    for (const batch of eligible) {
      if (remaining <= 0) break;
      const available = Number(batch.availableQuantity);
      const allocated = Math.min(available, remaining);
      const unitPrice = Number(batch.sellingPrice) || Number(batch.unitCost);
      const total = allocated * unitPrice;

      if (new Date(batch.expiryDate) < new Date()) {
        warnings.push(`EMERGENCY: Using expired batch ${batch.batchNumber}`);
      }
      if (batch.isQuarantined) {
        warnings.push(`EMERGENCY: Using quarantined batch ${batch.batchNumber}`);
      }

      items.push({
        batch,
        allocatedQuantity: allocated,
        unitPrice,
        totalPrice: total,
        isPartial: allocated < available,
      });

      totalCost += total;
      remaining -= allocated;
    }

    return {
      items,
      totalQuantity: requiredQuantity - remaining,
      totalCost,
      fullyAllocated: remaining <= 0,
      shortfall: Math.max(0, remaining),
      warnings,
    };
  }
}
