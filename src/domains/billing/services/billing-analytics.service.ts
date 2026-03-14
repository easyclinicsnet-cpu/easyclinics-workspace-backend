import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PatientBillRepository } from '../repositories/patient-bill.repository';
import { PaymentRepository } from '../repositories/payment.repository';
import { BillItemRepository } from '../repositories/bill-item.repository';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { BillingTransactionRepository } from '../repositories/billing-transaction.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';
import { BillAnalyticsDto } from '../dto/responses/bill.dto';
import { GetBillingSummaryDto } from '../dto/audit/get-billing-summary.dto';
import { BillingSummaryResponseDto } from '../dto/audit/billing-summary-response.dto';
import { BillStatus, PaymentStatus, MovementType } from '../../../common/enums';
import {
  BillingStrategyFactory,
  StrategyHealth,
} from '../strategies/billing-strategy.factory';

// ─── Response Interfaces ──────────────────────────────────────────────────────

/**
 * System health status for the billing subsystem.
 */
export interface BillingSystemHealthResponse {
  strategies: Array<{ name: string; status: string; features: string[] }>;
  databaseStatus: string;
  transactionCount: number;
  recentErrors: number;
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
}

/**
 * Exported analytics payload (CSV or JSON).
 */
export interface ExportedAnalyticsResponse {
  data: string;
  filename: string;
  contentType: string;
}

/**
 * Analytics breakdown for a single movement type category.
 */
export interface MovementTypeBreakdown {
  movementType: string;
  transactionCount: number;
  totalAmount: number;
  averageAmount: number;
  percentageOfTotal: number;
}

/**
 * Full movement-type analytics response.
 */
export interface MovementTypeAnalyticsResponse {
  period: { startDate: Date; endDate: Date };
  breakdown: MovementTypeBreakdown[];
  totalTransactions: number;
  totalAmount: number;
}

/**
 * Performance metrics for a single billing strategy.
 */
export interface StrategyPerformanceMetric {
  strategyName: string;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  successRate: number;
  averageProcessingTime: number;
  errorRate: number;
  totalAmount: number;
}

/**
 * Full strategy performance analytics response.
 */
export interface StrategyPerformanceAnalyticsResponse {
  period: { startDate: Date; endDate: Date };
  strategies: StrategyPerformanceMetric[];
  overallSuccessRate: number;
  overallAverageProcessingTime: number;
  overallErrorRate: number;
}

/**
 * Operational efficiency metrics derived from bill and transaction analytics.
 */
interface OperationalEfficiency {
  successRate: number;
  averageProcessingTime: number;
  reversalRate: number;
}

/**
 * Service for billing analytics and reporting
 * Provides revenue analysis, billing summaries, department breakdowns,
 * outstanding balances, daily revenue trends, system health monitoring,
 * data export, movement-type analytics, and strategy performance metrics.
 */
@Injectable()
export class BillingAnalyticsService {
  constructor(
    private readonly patientBillRepository: PatientBillRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly billItemRepository: BillItemRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly billingTransactionRepository: BillingTransactionRepository,
    private readonly strategyFactory: BillingStrategyFactory,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('BillingAnalyticsService');
  }

  /**
   * Get comprehensive billing analytics for a workspace
   * Includes total bills, revenue from PAID bills, outstanding amounts,
   * bills by status, revenue by department, average bill amount, and top items
   * @param workspaceId Workspace ID for multi-tenancy
   * @param startDate Optional start date for filtering
   * @param endDate Optional end date for filtering
   * @returns Billing analytics data
   */
  async getBillingAnalytics(
    workspaceId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<BillAnalyticsDto> {
    this.logger.log(
      `Getting billing analytics for workspace: ${workspaceId}`,
    );

    try {
      // Build base query builder for bills
      const billQb = this.patientBillRepository
        .createQueryBuilder('bill')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL');

      if (startDate) {
        billQb.andWhere('bill.issuedAt >= :startDate', { startDate });
      }
      if (endDate) {
        billQb.andWhere('bill.issuedAt <= :endDate', { endDate });
      }

      // Total bills count
      const totalBills = await billQb.getCount();

      // Total revenue from PAID bills
      const revenueResult = await this.patientBillRepository
        .createQueryBuilder('bill')
        .select('COALESCE(SUM(bill.total), 0)', 'totalRevenue')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.status = :paidStatus', { paidStatus: BillStatus.PAID })
        .andWhere(startDate ? 'bill.issuedAt >= :startDate' : '1=1', {
          startDate,
        })
        .andWhere(endDate ? 'bill.issuedAt <= :endDate' : '1=1', { endDate })
        .getRawOne();

      const totalRevenue = Number(revenueResult?.totalRevenue || 0);

      // Total outstanding (PENDING + PARTIALLY_PAID + OVERDUE)
      const outstandingResult = await this.patientBillRepository
        .createQueryBuilder('bill')
        .select('COALESCE(SUM(bill.total), 0)', 'totalOutstanding')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.status IN (:...outstandingStatuses)', {
          outstandingStatuses: [
            BillStatus.PENDING,
            BillStatus.PARTIALLY_PAID,
            BillStatus.OVERDUE,
          ],
        })
        .andWhere(startDate ? 'bill.issuedAt >= :startDate' : '1=1', {
          startDate,
        })
        .andWhere(endDate ? 'bill.issuedAt <= :endDate' : '1=1', { endDate })
        .getRawOne();

      const totalOutstanding = Number(
        outstandingResult?.totalOutstanding || 0,
      );

      // Bills by status
      const statusResults = await this.patientBillRepository
        .createQueryBuilder('bill')
        .select('bill.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere(startDate ? 'bill.issuedAt >= :startDate' : '1=1', {
          startDate,
        })
        .andWhere(endDate ? 'bill.issuedAt <= :endDate' : '1=1', { endDate })
        .groupBy('bill.status')
        .getRawMany();

      const billsByStatus: Record<string, number> = {};
      for (const row of statusResults) {
        billsByStatus[row.status] = Number(row.count);
      }

      // Revenue by department
      const departmentResults = await this.patientBillRepository
        .createQueryBuilder('bill')
        .select('bill.department', 'department')
        .addSelect('COALESCE(SUM(bill.total), 0)', 'revenue')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.status = :paidStatus', { paidStatus: BillStatus.PAID })
        .andWhere('bill.department IS NOT NULL')
        .andWhere(startDate ? 'bill.issuedAt >= :startDate' : '1=1', {
          startDate,
        })
        .andWhere(endDate ? 'bill.issuedAt <= :endDate' : '1=1', { endDate })
        .groupBy('bill.department')
        .getRawMany();

      const revenueByDepartment: Record<string, number> = {};
      for (const row of departmentResults) {
        if (row.department) {
          revenueByDepartment[row.department] = Number(row.revenue);
        }
      }

      // Average bill amount
      const averageBillAmount =
        totalBills > 0 ? Math.round((totalRevenue / totalBills) * 100) / 100 : 0;

      // Top items by count and total amount
      const topItemsQb = this.billItemRepository
        .createQueryBuilder('item')
        .select('item.description', 'description')
        .addSelect('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(item.totalPrice), 0)', 'totalAmount')
        .where('item.isActive = :isActive', { isActive: true })
        .andWhere('item.deletedAt IS NULL')
        .groupBy('item.description')
        .orderBy('count', 'DESC')
        .limit(10);

      if (startDate || endDate) {
        topItemsQb.innerJoin('item.bill', 'bill');
        if (startDate) {
          topItemsQb.andWhere('bill.issuedAt >= :startDate', { startDate });
        }
        if (endDate) {
          topItemsQb.andWhere('bill.issuedAt <= :endDate', { endDate });
        }
      }

      const topItemsResults = await topItemsQb.getRawMany();

      const topItems = topItemsResults.map((row) => ({
        description: row.description,
        count: Number(row.count),
        totalAmount: Number(row.totalAmount),
      }));

      const analytics: BillAnalyticsDto = {
        totalBills,
        totalRevenue,
        totalOutstanding,
        billsByStatus,
        revenueByDepartment,
        averageBillAmount,
        topItems,
      };

      this.logger.log(
        `Billing analytics retrieved - totalBills: ${totalBills}, revenue: ${totalRevenue}`,
      );

      return analytics;
    } catch (error) {
      this.logger.error(
        `Failed to get billing analytics for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get billing summary for a specific date range with optional department filter
   * @param dto Query parameters including date range and optional department
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Billing summary response
   */
  async getBillingSummary(
    dto: GetBillingSummaryDto,
    workspaceId: string,
  ): Promise<BillingSummaryResponseDto> {
    this.logger.log(
      `Getting billing summary for workspace: ${workspaceId}, period: ${dto.startDate} to ${dto.endDate}`,
    );

    try {
      const startDate = new Date(dto.startDate);
      const endDate = new Date(dto.endDate);

      // Build base query with date range
      const baseQb = this.patientBillRepository
        .createQueryBuilder('bill')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.issuedAt >= :startDate', { startDate })
        .andWhere('bill.issuedAt <= :endDate', { endDate });

      if (dto.department) {
        baseQb.andWhere('bill.department = :department', {
          department: dto.department,
        });
      }

      // Total bills
      const totalBills = await baseQb.getCount();

      // Total revenue (from PAID bills)
      const revenueQb = this.patientBillRepository
        .createQueryBuilder('bill')
        .select('COALESCE(SUM(bill.total), 0)', 'totalRevenue')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.issuedAt >= :startDate', { startDate })
        .andWhere('bill.issuedAt <= :endDate', { endDate })
        .andWhere('bill.status = :paidStatus', { paidStatus: BillStatus.PAID });

      if (dto.department) {
        revenueQb.andWhere('bill.department = :department', {
          department: dto.department,
        });
      }

      const revenueResult = await revenueQb.getRawOne();
      const totalRevenue = Number(revenueResult?.totalRevenue || 0);

      // Total payments in the period
      const paymentResult = await this.paymentRepository
        .createQueryBuilder('payment')
        .select('COALESCE(SUM(payment.amount), 0)', 'totalPayments')
        .where('payment.isActive = :isActive', { isActive: true })
        .andWhere('payment.deletedAt IS NULL')
        .andWhere('payment.status = :completedStatus', {
          completedStatus: PaymentStatus.COMPLETED,
        })
        .andWhere('payment.paymentDate >= :startDate', { startDate })
        .andWhere('payment.paymentDate <= :endDate', { endDate })
        .getRawOne();

      const totalPayments = Number(paymentResult?.totalPayments || 0);

      // Total outstanding
      const outstandingQb = this.patientBillRepository
        .createQueryBuilder('bill')
        .select('COALESCE(SUM(bill.total), 0)', 'totalOutstanding')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.issuedAt >= :startDate', { startDate })
        .andWhere('bill.issuedAt <= :endDate', { endDate })
        .andWhere('bill.status IN (:...outstandingStatuses)', {
          outstandingStatuses: [
            BillStatus.PENDING,
            BillStatus.PARTIALLY_PAID,
            BillStatus.OVERDUE,
          ],
        });

      if (dto.department) {
        outstandingQb.andWhere('bill.department = :department', {
          department: dto.department,
        });
      }

      const outstandingResult = await outstandingQb.getRawOne();
      const totalOutstanding = Number(
        outstandingResult?.totalOutstanding || 0,
      );

      // Average bill amount
      const averageBillAmount =
        totalBills > 0
          ? Math.round((totalRevenue / totalBills) * 100) / 100
          : 0;

      // Bills by status
      const statusQb = this.patientBillRepository
        .createQueryBuilder('bill')
        .select('bill.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.issuedAt >= :startDate', { startDate })
        .andWhere('bill.issuedAt <= :endDate', { endDate })
        .groupBy('bill.status');

      if (dto.department) {
        statusQb.andWhere('bill.department = :department', {
          department: dto.department,
        });
      }

      const statusResults = await statusQb.getRawMany();
      const billsByStatus: Record<string, number> = {};
      for (const row of statusResults) {
        billsByStatus[row.status] = Number(row.count);
      }

      // Payments by method
      const paymentMethodResults = await this.paymentRepository
        .createQueryBuilder('payment')
        .leftJoin('payment.paymentMethod', 'method')
        .select('method.name', 'methodName')
        .addSelect('COALESCE(SUM(payment.amount), 0)', 'total')
        .where('payment.isActive = :isActive', { isActive: true })
        .andWhere('payment.deletedAt IS NULL')
        .andWhere('payment.status = :completedStatus', {
          completedStatus: PaymentStatus.COMPLETED,
        })
        .andWhere('payment.paymentDate >= :startDate', { startDate })
        .andWhere('payment.paymentDate <= :endDate', { endDate })
        .groupBy('method.name')
        .getRawMany();

      const paymentsByMethod: Record<string, number> = {};
      for (const row of paymentMethodResults) {
        const methodName = row.methodName || 'Unknown';
        paymentsByMethod[methodName] = Number(row.total);
      }

      // Revenue by department
      const departmentQb = this.patientBillRepository
        .createQueryBuilder('bill')
        .select('bill.department', 'department')
        .addSelect('COALESCE(SUM(bill.total), 0)', 'revenue')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.status = :paidStatus', { paidStatus: BillStatus.PAID })
        .andWhere('bill.issuedAt >= :startDate', { startDate })
        .andWhere('bill.issuedAt <= :endDate', { endDate })
        .andWhere('bill.department IS NOT NULL')
        .groupBy('bill.department');

      const departmentResults = await departmentQb.getRawMany();
      const revenueByDepartment: Record<string, number> = {};
      for (const row of departmentResults) {
        if (row.department) {
          revenueByDepartment[row.department] = Number(row.revenue);
        }
      }

      const summary: BillingSummaryResponseDto = {
        totalBills,
        totalRevenue,
        totalPayments,
        totalOutstanding,
        averageBillAmount,
        billsByStatus,
        paymentsByMethod,
        revenueByDepartment,
        period: {
          startDate,
          endDate,
        },
      };

      this.logger.log(
        `Billing summary retrieved - totalBills: ${totalBills}, revenue: ${totalRevenue}`,
      );

      return summary;
    } catch (error) {
      this.logger.error(
        `Failed to get billing summary for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get revenue breakdown by department for a date range
   * @param workspaceId Workspace ID for multi-tenancy
   * @param startDate Start date
   * @param endDate End date
   * @returns Revenue totals keyed by department name
   */
  async getRevenueByDepartment(
    workspaceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Record<string, number>> {
    this.logger.log(
      `Getting revenue by department for workspace: ${workspaceId}`,
    );

    try {
      const results = await this.patientBillRepository
        .createQueryBuilder('bill')
        .select('bill.department', 'department')
        .addSelect('COALESCE(SUM(bill.total), 0)', 'revenue')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.status = :paidStatus', { paidStatus: BillStatus.PAID })
        .andWhere('bill.issuedAt >= :startDate', { startDate })
        .andWhere('bill.issuedAt <= :endDate', { endDate })
        .andWhere('bill.department IS NOT NULL')
        .groupBy('bill.department')
        .orderBy('revenue', 'DESC')
        .getRawMany();

      const revenueByDepartment: Record<string, number> = {};
      for (const row of results) {
        if (row.department) {
          revenueByDepartment[row.department] = Number(row.revenue);
        }
      }

      this.logger.log(
        `Revenue by department retrieved - ${Object.keys(revenueByDepartment).length} departments`,
      );

      return revenueByDepartment;
    } catch (error) {
      this.logger.error(
        `Failed to get revenue by department for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get payment method analysis showing count and total amount per payment method
   * @param workspaceId Workspace ID for multi-tenancy
   * @param startDate Start date
   * @param endDate End date
   * @returns Payment method breakdown with count and total for each method
   */
  async getPaymentMethodAnalysis(
    workspaceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Record<string, { count: number; total: number }>> {
    this.logger.log(
      `Getting payment method analysis for workspace: ${workspaceId}`,
    );

    try {
      const results = await this.paymentRepository
        .createQueryBuilder('payment')
        .leftJoin('payment.paymentMethod', 'method')
        .select('method.name', 'methodName')
        .addSelect('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(payment.amount), 0)', 'total')
        .where('payment.isActive = :isActive', { isActive: true })
        .andWhere('payment.deletedAt IS NULL')
        .andWhere('payment.status = :completedStatus', {
          completedStatus: PaymentStatus.COMPLETED,
        })
        .andWhere('payment.paymentDate >= :startDate', { startDate })
        .andWhere('payment.paymentDate <= :endDate', { endDate })
        .groupBy('method.name')
        .orderBy('total', 'DESC')
        .getRawMany();

      const analysis: Record<string, { count: number; total: number }> = {};
      for (const row of results) {
        const methodName = row.methodName || 'Unknown';
        analysis[methodName] = {
          count: Number(row.count),
          total: Number(row.total),
        };
      }

      this.logger.log(
        `Payment method analysis retrieved - ${Object.keys(analysis).length} methods`,
      );

      return analysis;
    } catch (error) {
      this.logger.error(
        `Failed to get payment method analysis for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get outstanding bills summary including total amount, count, and overdue count
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Outstanding bills summary with total amount, count, and overdue count
   */
  async getOutstandingBills(
    workspaceId: string,
  ): Promise<{ total: number; count: number; overdue: number }> {
    this.logger.log(
      `Getting outstanding bills for workspace: ${workspaceId}`,
    );

    try {
      // Total outstanding (PENDING + PARTIALLY_PAID + OVERDUE)
      const outstandingResult = await this.patientBillRepository
        .createQueryBuilder('bill')
        .select('COALESCE(SUM(bill.total), 0)', 'total')
        .addSelect('COUNT(*)', 'count')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.status IN (:...outstandingStatuses)', {
          outstandingStatuses: [
            BillStatus.PENDING,
            BillStatus.PARTIALLY_PAID,
            BillStatus.OVERDUE,
          ],
        })
        .getRawOne();

      // Overdue bills (past due date and still unpaid)
      const overdueResult = await this.patientBillRepository
        .createQueryBuilder('bill')
        .select('COUNT(*)', 'overdue')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.status IN (:...unpaidStatuses)', {
          unpaidStatuses: [BillStatus.PENDING, BillStatus.PARTIALLY_PAID],
        })
        .andWhere('bill.dueDate < :now', { now: new Date() })
        .getRawOne();

      const result = {
        total: Number(outstandingResult?.total || 0),
        count: Number(outstandingResult?.count || 0),
        overdue: Number(overdueResult?.overdue || 0),
      };

      this.logger.log(
        `Outstanding bills retrieved - total: ${result.total}, count: ${result.count}, overdue: ${result.overdue}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get outstanding bills for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get daily revenue breakdown for the last N days
   * Returns revenue and bill count per day
   * @param workspaceId Workspace ID for multi-tenancy
   * @param days Number of days to look back
   * @returns Array of daily revenue data points
   */
  async getDailyRevenue(
    workspaceId: string,
    days: number = 30,
  ): Promise<Array<{ date: string; revenue: number; billCount: number }>> {
    this.logger.log(
      `Getting daily revenue for workspace: ${workspaceId}, last ${days} days`,
    );

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      const results = await this.patientBillRepository
        .createQueryBuilder('bill')
        .select('DATE(bill.issuedAt)', 'date')
        .addSelect('COALESCE(SUM(bill.total), 0)', 'revenue')
        .addSelect('COUNT(*)', 'billCount')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.status = :paidStatus', { paidStatus: BillStatus.PAID })
        .andWhere('bill.issuedAt >= :startDate', { startDate })
        .groupBy('DATE(bill.issuedAt)')
        .orderBy('date', 'ASC')
        .getRawMany();

      // Build a complete date range including days with zero revenue
      const dailyRevenue: Array<{
        date: string;
        revenue: number;
        billCount: number;
      }> = [];

      const revenueMap = new Map<
        string,
        { revenue: number; billCount: number }
      >();

      for (const row of results) {
        const dateStr =
          row.date instanceof Date
            ? row.date.toISOString().split('T')[0]
            : String(row.date);
        revenueMap.set(dateStr, {
          revenue: Number(row.revenue),
          billCount: Number(row.billCount),
        });
      }

      // Fill in all days in the range
      const currentDate = new Date(startDate);
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      while (currentDate <= today) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const data = revenueMap.get(dateStr);

        dailyRevenue.push({
          date: dateStr,
          revenue: data?.revenue || 0,
          billCount: data?.billCount || 0,
        });

        currentDate.setDate(currentDate.getDate() + 1);
      }

      this.logger.log(
        `Daily revenue retrieved - ${dailyRevenue.length} days of data`,
      );

      return dailyRevenue;
    } catch (error) {
      this.logger.error(
        `Failed to get daily revenue for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // New Methods – Legacy Business-Logic Parity
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Returns the overall health status of the billing subsystem.
   *
   * Checks:
   * 1. Each registered billing strategy's health (via the strategy factory).
   * 2. Database connectivity by running a lightweight query.
   * 3. Recent transaction volume (last 24 hours).
   * 4. Recent error / failed-transaction count (last 24 hours).
   *
   * The aggregate status is:
   * - `HEALTHY`   – all strategies healthy, DB reachable, error rate < 5 %.
   * - `DEGRADED`  – at least one strategy unhealthy **or** error rate >= 5 %.
   * - `UNHEALTHY` – DB unreachable **or** all strategies unhealthy.
   *
   * @param workspaceId Workspace identifier for multi-tenancy scoping
   * @returns Billing system health report
   */
  async getBillingSystemHealth(
    workspaceId: string,
  ): Promise<BillingSystemHealthResponse> {
    this.logger.log(
      `Getting billing system health for workspace: ${workspaceId}`,
    );

    try {
      // 1. Strategy health
      const strategyHealthResults: StrategyHealth[] =
        await this.strategyFactory.getAllStrategiesHealth();

      const strategies = strategyHealthResults.map((sh) => {
        const metadata =
          this.strategyFactory.getStrategyMetadata(sh.name);
        const features: string[] = metadata
          ? metadata.supportedMovementTypes.map((mt) => String(mt))
          : [];
        return {
          name: sh.name,
          status: sh.isHealthy ? 'HEALTHY' : 'UNHEALTHY',
          features,
        };
      });

      // 2. Database connectivity
      let databaseStatus = 'CONNECTED';
      try {
        await this.dataSource.query('SELECT 1');
      } catch {
        databaseStatus = 'DISCONNECTED';
      }

      // 3. Recent transactions (last 24 h)
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const transactionCountResult = await this.billingTransactionRepository
        .createQueryBuilder('txn')
        .select('COUNT(*)', 'total')
        .where('txn.isActive = :isActive', { isActive: true })
        .andWhere('txn.deletedAt IS NULL')
        .andWhere('txn.transactionDate >= :since', {
          since: twentyFourHoursAgo,
        })
        .getRawOne();

      const transactionCount = Number(transactionCountResult?.total || 0);

      // 4. Recent errors (failed transactions in last 24 h)
      const recentErrorsResult = await this.billingTransactionRepository
        .createQueryBuilder('txn')
        .select('COUNT(*)', 'errors')
        .where('txn.isActive = :isActive', { isActive: true })
        .andWhere('txn.deletedAt IS NULL')
        .andWhere('txn.transactionDate >= :since', {
          since: twentyFourHoursAgo,
        })
        .andWhere('txn.status = :failedStatus', { failedStatus: 'FAILED' })
        .getRawOne();

      const recentErrors = Number(recentErrorsResult?.errors || 0);

      // 5. Determine aggregate status
      const allStrategiesHealthy = strategies.every(
        (s) => s.status === 'HEALTHY',
      );
      const anyStrategyHealthy = strategies.some(
        (s) => s.status === 'HEALTHY',
      );
      const errorRate =
        transactionCount > 0 ? recentErrors / transactionCount : 0;

      let status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
      if (databaseStatus === 'DISCONNECTED' || !anyStrategyHealthy) {
        status = 'UNHEALTHY';
      } else if (!allStrategiesHealthy || errorRate >= 0.05) {
        status = 'DEGRADED';
      } else {
        status = 'HEALTHY';
      }

      this.logger.log(
        `Billing system health: ${status} – strategies: ${strategies.length}, txns(24h): ${transactionCount}, errors(24h): ${recentErrors}`,
      );

      return {
        strategies,
        databaseStatus,
        transactionCount,
        recentErrors,
        status,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get billing system health for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Export billing analytics data in either CSV or JSON format.
   *
   * Internally delegates to {@link getBillingAnalytics} and then formats
   * the result according to the requested `format`.
   *
   * @param startDate  Beginning of the analytics period
   * @param endDate    End of the analytics period
   * @param format     Export format – `'CSV'` or `'JSON'`
   * @param workspaceId Workspace identifier for multi-tenancy scoping
   * @returns Object containing the serialised data, a suggested filename, and the MIME content type
   */
  async exportBillingAnalytics(
    startDate: Date,
    endDate: Date,
    format: 'CSV' | 'JSON',
    workspaceId: string,
    userId?: string,
  ): Promise<ExportedAnalyticsResponse> {
    this.logger.log(
      `Exporting billing analytics (${format}) for workspace: ${workspaceId}`,
    );

    try {
      const analytics = await this.getBillingAnalytics(
        workspaceId,
        startDate,
        endDate,
      );

      const dateStamp = new Date().toISOString().split('T')[0];
      let result: ExportedAnalyticsResponse;

      if (format === 'CSV') {
        const csvData = this.convertAnalyticsToCSV(analytics);
        result = {
          data: csvData,
          filename: `billing-analytics-${workspaceId}-${dateStamp}.csv`,
          contentType: 'text/csv',
        };
      } else {
        const jsonData = JSON.stringify(analytics, null, 2);
        result = {
          data: jsonData,
          filename: `billing-analytics-${workspaceId}-${dateStamp}.json`,
          contentType: 'application/json',
        };
      }

      try {
        await this.auditLogService.log({
          userId: userId || 'system',
          action: 'EXPORT_BILLING_ANALYTICS',
          eventType: AuditEventType.READ,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'BillingAnalytics',
          justification: 'Billing analytics data export',
          metadata: {
            format,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            filename: result.filename,
          },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log for exportBillingAnalytics', auditError.stack);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to export billing analytics for workspace: ${workspaceId}`,
        error.stack,
      );

      try {
        await this.auditLogService.log({
          userId: userId || 'system',
          action: 'EXPORT_BILLING_ANALYTICS',
          eventType: AuditEventType.READ,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'BillingAnalytics',
          justification: 'Billing analytics export failed',
          metadata: { format, error: (error as Error).message },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log for export failure', auditError.stack);
      }

      throw error;
    }
  }

  /**
   * Retrieve transaction analytics grouped by movement type.
   *
   * Queries the `billing_transactions` table, grouping by `transactionType`
   * and restricting to the billing-relevant movement types (DISPENSE,
   * SERVICE, RETURN, and all ADJUSTMENT variants).
   *
   * @param startDate   Beginning of the analytics period
   * @param endDate     End of the analytics period
   * @param workspaceId Workspace identifier for multi-tenancy scoping
   * @returns Breakdown of transactions per movement type with counts, amounts, and percentages
   */
  async getMovementTypeAnalytics(
    startDate: Date,
    endDate: Date,
    workspaceId: string,
  ): Promise<MovementTypeAnalyticsResponse> {
    this.logger.log(
      `Getting movement type analytics for workspace: ${workspaceId}`,
    );

    try {
      const relevantTypes: string[] = [
        MovementType.DISPENSE,
        MovementType.SERVICE,
        MovementType.RETURN,
        MovementType.ADJUSTMENT,
        MovementType.ADJUSTMENT_IN,
        MovementType.ADJUSTMENT_OUT,
        MovementType.ADJUSTMENT_CORRECTION,
      ];

      const rawResults = await this.billingTransactionRepository
        .createQueryBuilder('txn')
        .select('txn.transactionType', 'movementType')
        .addSelect('COUNT(*)', 'transactionCount')
        .addSelect('COALESCE(SUM(ABS(txn.amount)), 0)', 'totalAmount')
        .where('txn.isActive = :isActive', { isActive: true })
        .andWhere('txn.deletedAt IS NULL')
        .andWhere('txn.transactionDate >= :startDate', { startDate })
        .andWhere('txn.transactionDate <= :endDate', { endDate })
        .andWhere('txn.transactionType IN (:...types)', {
          types: relevantTypes,
        })
        .groupBy('txn.transactionType')
        .orderBy('transactionCount', 'DESC')
        .getRawMany();

      // Compute totals for percentage calculations
      let totalTransactions = 0;
      let totalAmount = 0;
      for (const row of rawResults) {
        totalTransactions += Number(row.transactionCount);
        totalAmount += Number(row.totalAmount);
      }

      const breakdown: MovementTypeBreakdown[] = rawResults.map((row) => {
        const count = Number(row.transactionCount);
        const amount = Number(row.totalAmount);
        const avg = count > 0 ? Math.round((amount / count) * 100) / 100 : 0;
        const pct =
          totalAmount > 0
            ? Math.round((amount / totalAmount) * 10000) / 100
            : 0;
        return {
          movementType: row.movementType,
          transactionCount: count,
          totalAmount: amount,
          averageAmount: avg,
          percentageOfTotal: pct,
        };
      });

      this.logger.log(
        `Movement type analytics retrieved – ${breakdown.length} types, ${totalTransactions} total txns`,
      );

      return {
        period: { startDate, endDate },
        breakdown,
        totalTransactions,
        totalAmount,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get movement type analytics for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Retrieve performance metrics for each billing strategy.
   *
   * Groups billing transactions by `transactionType` (which maps to the
   * strategy that processed them) and computes success rates, error rates,
   * and average processing times using the `metadata.processingTimeMs` field
   * stored by the strategies at execution time.
   *
   * @param startDate   Beginning of the analytics period
   * @param endDate     End of the analytics period
   * @param workspaceId Workspace identifier for multi-tenancy scoping
   * @returns Per-strategy performance metrics plus overall aggregates
   */
  async getStrategyPerformanceAnalytics(
    startDate: Date,
    endDate: Date,
    workspaceId: string,
  ): Promise<StrategyPerformanceAnalyticsResponse> {
    this.logger.log(
      `Getting strategy performance analytics for workspace: ${workspaceId}`,
    );

    try {
      // Aggregate counts and amounts grouped by transactionType and status
      const rawResults = await this.billingTransactionRepository
        .createQueryBuilder('txn')
        .select('txn.transactionType', 'strategyName')
        .addSelect('txn.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(ABS(txn.amount)), 0)', 'totalAmount')
        .where('txn.isActive = :isActive', { isActive: true })
        .andWhere('txn.deletedAt IS NULL')
        .andWhere('txn.transactionDate >= :startDate', { startDate })
        .andWhere('txn.transactionDate <= :endDate', { endDate })
        .groupBy('txn.transactionType')
        .addGroupBy('txn.status')
        .getRawMany();

      // Pivot results: strategyName -> { total, successful, failed, amount }
      const pivotMap = new Map<
        string,
        {
          total: number;
          successful: number;
          failed: number;
          amount: number;
        }
      >();

      const successStatuses = new Set(['COMMITTED', 'COMPLETED', 'SUCCESS']);
      const failedStatuses = new Set(['FAILED', 'ROLLED_BACK', 'ERROR']);

      for (const row of rawResults) {
        const key: string = row.strategyName;
        const count = Number(row.count);
        const amount = Number(row.totalAmount);
        const statusUpper = String(row.status).toUpperCase();

        if (!pivotMap.has(key)) {
          pivotMap.set(key, { total: 0, successful: 0, failed: 0, amount: 0 });
        }
        const entry = pivotMap.get(key)!;
        entry.total += count;
        entry.amount += amount;

        if (successStatuses.has(statusUpper)) {
          entry.successful += count;
        } else if (failedStatuses.has(statusUpper)) {
          entry.failed += count;
        }
      }

      // Build per-strategy metrics
      const strategies: StrategyPerformanceMetric[] = [];
      let overallTotal = 0;
      let overallSuccessful = 0;
      let overallFailed = 0;

      for (const [name, entry] of pivotMap.entries()) {
        const successRate =
          entry.total > 0
            ? Math.round((entry.successful / entry.total) * 10000) / 100
            : 0;
        const errorRate =
          entry.total > 0
            ? Math.round((entry.failed / entry.total) * 10000) / 100
            : 0;

        // Estimate avg processing time from metadata if available;
        // fallback to a heuristic based on transaction volume
        const avgProcessingTime = await this.estimateAverageProcessingTime(
          name,
          startDate,
          endDate,
        );

        strategies.push({
          strategyName: name,
          totalTransactions: entry.total,
          successfulTransactions: entry.successful,
          failedTransactions: entry.failed,
          successRate,
          averageProcessingTime: avgProcessingTime,
          errorRate,
          totalAmount: entry.amount,
        });

        overallTotal += entry.total;
        overallSuccessful += entry.successful;
        overallFailed += entry.failed;
      }

      const overallSuccessRate =
        overallTotal > 0
          ? Math.round((overallSuccessful / overallTotal) * 10000) / 100
          : 0;
      const overallErrorRate =
        overallTotal > 0
          ? Math.round((overallFailed / overallTotal) * 10000) / 100
          : 0;
      const overallAverageProcessingTime =
        strategies.length > 0
          ? Math.round(
              (strategies.reduce((sum, s) => sum + s.averageProcessingTime, 0) /
                strategies.length) *
                100,
            ) / 100
          : 0;

      this.logger.log(
        `Strategy performance analytics retrieved – ${strategies.length} strategies, overall success: ${overallSuccessRate}%`,
      );

      return {
        period: { startDate, endDate },
        strategies,
        overallSuccessRate,
        overallAverageProcessingTime,
        overallErrorRate,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get strategy performance analytics for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Convert a {@link BillAnalyticsDto} to a flat CSV string.
   *
   * Sections emitted:
   * 1. Summary row (totalBills, totalRevenue, totalOutstanding, averageBillAmount)
   * 2. Bills-by-status table
   * 3. Revenue-by-department table
   * 4. Top-items table (description, count, totalAmount)
   *
   * @param analytics The analytics payload to serialise
   * @returns A UTF-8 CSV string
   */
  private convertAnalyticsToCSV(analytics: BillAnalyticsDto): string {
    const lines: string[] = [];

    // Section 1 – Summary
    lines.push('Section,Metric,Value');
    lines.push(
      `Summary,Total Bills,${analytics.totalBills}`,
    );
    lines.push(
      `Summary,Total Revenue,${analytics.totalRevenue}`,
    );
    lines.push(
      `Summary,Total Outstanding,${analytics.totalOutstanding}`,
    );
    lines.push(
      `Summary,Average Bill Amount,${analytics.averageBillAmount}`,
    );
    lines.push('');

    // Section 2 – Bills by Status
    lines.push('Status,Count');
    for (const [status, count] of Object.entries(
      analytics.billsByStatus,
    )) {
      lines.push(`${this.escapeCsvField(status)},${count}`);
    }
    lines.push('');

    // Section 3 – Revenue by Department
    lines.push('Department,Revenue');
    for (const [department, revenue] of Object.entries(
      analytics.revenueByDepartment,
    )) {
      lines.push(
        `${this.escapeCsvField(department)},${revenue}`,
      );
    }
    lines.push('');

    // Section 4 – Top Items
    lines.push('Item Description,Count,Total Amount');
    for (const item of analytics.topItems) {
      lines.push(
        `${this.escapeCsvField(item.description)},${item.count},${item.totalAmount}`,
      );
    }

    return lines.join('\n');
  }

  /**
   * Calculate operational efficiency metrics from bill and transaction data.
   *
   * @param billAnalytics  High-level bill analytics (from {@link getBillingAnalytics})
   * @param transactionAnalytics Raw transaction aggregation data
   * @returns Operational efficiency metrics
   */
  private calculateOperationalEfficiency(
    billAnalytics: BillAnalyticsDto,
    transactionAnalytics: {
      totalTransactions: number;
      failedTransactions: number;
      reversedTransactions: number;
      averageProcessingTimeMs: number;
    },
  ): OperationalEfficiency {
    const { totalTransactions, failedTransactions, reversedTransactions, averageProcessingTimeMs } =
      transactionAnalytics;

    const successRate =
      totalTransactions > 0
        ? Math.round(
            ((totalTransactions - failedTransactions) / totalTransactions) *
              10000,
          ) / 100
        : 100;

    const reversalRate =
      totalTransactions > 0
        ? Math.round(
            (reversedTransactions / totalTransactions) * 10000,
          ) / 100
        : 0;

    return {
      successRate,
      averageProcessingTime: averageProcessingTimeMs,
      reversalRate,
    };
  }

  /**
   * Escape a value for safe inclusion in a CSV field.
   * Wraps the value in double-quotes if it contains commas, quotes, or newlines.
   *
   * @param value Raw field value
   * @returns Escaped CSV-safe string
   */
  private escapeCsvField(value: string): string {
    if (!value) {
      return '';
    }
    if (
      value.includes(',') ||
      value.includes('"') ||
      value.includes('\n')
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * Estimate the average processing time for a given strategy (transaction type)
   * by sampling recent transactions and computing the time delta between
   * `createdAt` and `transactionDate` stored on the entity.
   *
   * If the metadata JSON contains a `processingTimeMs` field, that value is
   * preferred. Otherwise the delta between `createdAt` and `transactionDate`
   * is used as a proxy.
   *
   * @param transactionType Strategy / transaction type to analyse
   * @param startDate       Period start
   * @param endDate         Period end
   * @returns Average processing time in milliseconds (0 when no data)
   */
  private async estimateAverageProcessingTime(
    transactionType: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    try {
      // Sample up to 100 recent transactions for this type
      const samples = await this.billingTransactionRepository
        .createQueryBuilder('txn')
        .select(['txn.createdAt', 'txn.transactionDate', 'txn.metadata'])
        .where('txn.isActive = :isActive', { isActive: true })
        .andWhere('txn.deletedAt IS NULL')
        .andWhere('txn.transactionType = :type', { type: transactionType })
        .andWhere('txn.transactionDate >= :startDate', { startDate })
        .andWhere('txn.transactionDate <= :endDate', { endDate })
        .orderBy('txn.transactionDate', 'DESC')
        .limit(100)
        .getRawMany();

      if (samples.length === 0) {
        return 0;
      }

      let totalMs = 0;
      let counted = 0;

      for (const sample of samples) {
        // Prefer metadata.processingTimeMs if present
        const meta =
          typeof sample.txn_metadata === 'string'
            ? JSON.parse(sample.txn_metadata)
            : sample.txn_metadata;

        if (meta?.processingTimeMs && typeof meta.processingTimeMs === 'number') {
          totalMs += meta.processingTimeMs;
          counted++;
        } else if (sample.txn_createdAt && sample.txn_transactionDate) {
          const created = new Date(sample.txn_createdAt).getTime();
          const txnDate = new Date(sample.txn_transactionDate).getTime();
          const delta = Math.abs(txnDate - created);
          // Only count reasonable deltas (< 1 hour) to avoid outliers
          if (delta < 3_600_000) {
            totalMs += delta;
            counted++;
          }
        }
      }

      return counted > 0 ? Math.round(totalMs / counted) : 0;
    } catch {
      return 0;
    }
  }
}
