export class BillingSummaryResponseDto {
  totalBills: number;
  totalRevenue: number;
  totalPayments: number;
  totalOutstanding: number;
  averageBillAmount: number;
  billsByStatus: Record<string, number>;
  paymentsByMethod: Record<string, number>;
  revenueByDepartment: Record<string, number>;
  period: {
    startDate: Date;
    endDate: Date;
  };
}
