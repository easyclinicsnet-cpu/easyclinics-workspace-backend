import { Batch } from '../../entities/batch.entity';
import { IBatchSelectionStrategy, IBatchSelectionCriteria, IBatchSelectionResult, IBatchSelectionItem } from '../../interfaces';

/**
 * First Expired, First Out (FEFO) Strategy
 * Prioritizes batches closest to expiry to minimize waste
 */
export class FEFOStrategy implements IBatchSelectionStrategy {
  select(
    batches: Batch[],
    requiredQuantity: number,
    criteria: IBatchSelectionCriteria,
  ): IBatchSelectionResult {
    const now = new Date();
    const eligible = batches
      .filter((b) => {
        if (b.isQuarantined && criteria.excludeQuarantined !== false) return false;
        if (new Date(b.expiryDate) < now && criteria.excludeExpired !== false) return false;
        if (Number(b.availableQuantity) <= 0) return false;
        if (criteria.requireSterile && !b.isSterile) return false;
        return true;
      })
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

    const items: IBatchSelectionItem[] = [];
    let remaining = requiredQuantity;
    let totalCost = 0;

    for (const batch of eligible) {
      if (remaining <= 0) break;
      const available = Number(batch.availableQuantity);
      const allocated = Math.min(available, remaining);
      const unitPrice = Number(batch.sellingPrice) || Number(batch.unitCost);
      const total = allocated * unitPrice;

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
      warnings: remaining > 0 ? [`Insufficient stock. Shortfall: ${remaining}`] : [],
    };
  }
}
