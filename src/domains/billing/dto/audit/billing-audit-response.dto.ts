export class BillingAuditResponseDto {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  userId: string;
  workspaceId: string;
  patientId?: string;
  previousState?: Record<string, any>;
  newState?: Record<string, any>;
  metadata?: Record<string, any>;
  timestamp: Date;
  createdAt: Date;
}
