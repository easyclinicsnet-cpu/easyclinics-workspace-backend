import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../../modules/audit-log/entities/audit-log.entity';

@Injectable()
export class ActivityLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async log(entry: {
    userId: string;
    action: string;
    ipAddress: string;
    userAgent: string;
    metadata: Record<string, any>;
    eventType?: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'EXPORT' | 'LOGIN' | 'OTHER';
    outcome?: 'success' | 'failure';
    patientId?: string;
    justification?: string;
  }): Promise<void> {
    // Redact sensitive data
    const redactedMetadata = this.redactPHI(entry.metadata);

    await this.auditLogRepository.save({
      userId: entry.userId,
      action: entry.action,
      metadata: {
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        ...redactedMetadata,
      },
      eventType: entry.eventType || 'OTHER',
      outcome: entry.outcome || 'success',
      patientId: entry.patientId,
      justification: entry.justification,
    });
  }

  private redactPHI(data: any): any {
    if (typeof data !== 'object' || data === null) return data;

    return Object.entries(data).reduce<Record<string, any>>((acc, [key, value]) => {
        if (key.match(/ssn|health|medical|diagnosis/i)) {
            acc[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
            acc[key] = this.redactPHI(value);
        } else {
            acc[key] = value;
        }
        return acc;
    }, {});
}
}
