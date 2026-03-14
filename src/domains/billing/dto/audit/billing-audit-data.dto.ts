export class BillingAuditDataDto {
  action: string;
  resourceType: string;
  resourceId: string;
  userId: string;
  workspaceId: string;
  patientId?: string;
  billId?: string;
  paymentId?: string;
  amount?: number;
  previousState?: Record<string, any>;
  newState?: Record<string, any>;
  metadata?: Record<string, any>;
  timestamp: Date;
}
