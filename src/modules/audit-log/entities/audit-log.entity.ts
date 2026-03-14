import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity()
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  userId!: string; // ID of the user who performed the action

  @Column()
  action!: string; // e.g., "PATIENT_RECORD_ACCESS"

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  timestamp!: Date;

  @Column({
    type: 'longtext',
    nullable: true,
    transformer: {
      to: (value: any) => (value ? JSON.stringify(value) : null),
      from: (value: string | null) => {
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      },
    },
  })
  metadata!: {
    ipAddress: string;
    userAgent: string;
    resourceId?: string;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
  };

  @Column()
  outcome!: 'success' | 'failure'; // Whether the action was successful

  // HIPAA-required fields
  @Column({ nullable: true })
  patientId?: string; // If action involved a specific patient

  @Column({ type: 'text', nullable: true })
  justification?: string; // Reason for access if sensitive

  @Column()
  @Index()
  eventType!:
    | 'CREATE'
    | 'READ'
    | 'UPDATE'
    | 'DELETE'
    | 'EXPORT'
    | 'LOGIN'
    | 'OTHER';
}
