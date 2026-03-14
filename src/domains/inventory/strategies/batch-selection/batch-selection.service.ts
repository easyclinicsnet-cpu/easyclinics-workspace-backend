import { Injectable } from '@nestjs/common';
import { Batch } from '../../entities/batch.entity';
import { IBatchSelectionCriteria, IBatchSelectionResult, IBatchSelectionStrategy } from '../../interfaces';
import { BatchPriority } from '../../enums';
import { FEFOStrategy } from './fefo.strategy';
import { OptimalCostStrategy } from './optimal-cost.strategy';
import { EmergencyStrategy } from './emergency.strategy';

@Injectable()
export class BatchSelectionService {
  private readonly strategies: Map<BatchPriority, IBatchSelectionStrategy>;

  constructor() {
    this.strategies = new Map();
    this.strategies.set(BatchPriority.FEFO, new FEFOStrategy());
    this.strategies.set(BatchPriority.FIFO, new FEFOStrategy());
    this.strategies.set(BatchPriority.OPTIMAL_COST, new OptimalCostStrategy());
    this.strategies.set(BatchPriority.EMERGENCY, new EmergencyStrategy());
  }

  selectBatches(
    batches: Batch[],
    quantity: number,
    criteria: IBatchSelectionCriteria,
  ): IBatchSelectionResult {
    const priority = criteria.priority || BatchPriority.FEFO;
    const strategy = this.strategies.get(priority) || new FEFOStrategy();
    return strategy.select(batches, quantity, criteria);
  }
}
