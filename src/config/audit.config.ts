import { registerAs } from '@nestjs/config';

/**
 * Audit Configuration
 * Settings for audit logging, retention, and HIPAA compliance
 */
export default registerAs('audit', () => ({
  // Retention policy (days) - Default: 730 days (2 years)
  // HIPAA requires audit logs to be retained for at least 6 years
  retentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS || '730', 10),

  // Maximum audit log storage capacity (bytes) - Default: 10GB
  maxCapacity: parseInt(process.env.AUDIT_MAX_CAPACITY_BYTES || '10737418240', 10),

  // PHI redaction patterns (case-insensitive regex patterns)
  // Fields matching these patterns will be redacted in audit logs
  phiPatterns: [
    /ssn/i,
    /social.*security/i,
    /health/i,
    /medical/i,
    /diagnosis/i,
    /prescription/i,
    /medication/i,
    /password/i,
    /token/i,
    /secret/i,
    /api.*key/i,
    /credit.*card/i,
    /card.*number/i,
    /cvv/i,
    /account.*number/i,
    /routing.*number/i,
    /national.*id/i,
    /passport/i,
    /driver.*license/i,
  ],

  // Enable anomaly detection
  // When enabled, the system will flag suspicious patterns in audit logs
  enableAnomalyDetection:
    process.env.AUDIT_ANOMALY_DETECTION === 'true' ||
    process.env.AUDIT_ANOMALY_DETECTION === undefined,

  // HIPAA compliance mode - Default: true
  // When enabled, enforces strict HIPAA compliance rules:
  // - PHI redaction in audit logs
  // - Patient access tracking with justification
  // - Immutable audit logs (no updates or deletes)
  // - Extended retention period
  hipaaMode: process.env.AUDIT_HIPAA_MODE !== 'false',

  // Audit log batch size for high-volume operations
  batchSize: parseInt(process.env.AUDIT_BATCH_SIZE || '100', 10),

  // Enable real-time audit log streaming (for external SIEM systems)
  enableStreaming: process.env.AUDIT_ENABLE_STREAMING === 'true',

  // Audit log compression (for storage optimization)
  enableCompression: process.env.AUDIT_ENABLE_COMPRESSION === 'true',

  // Suspicious activity threshold (number of failures before alerting)
  suspiciousActivityThreshold: parseInt(
    process.env.AUDIT_SUSPICIOUS_ACTIVITY_THRESHOLD || '5',
    10,
  ),

  // Suspicious activity time window (minutes)
  suspiciousActivityWindow: parseInt(
    process.env.AUDIT_SUSPICIOUS_ACTIVITY_WINDOW || '60',
    10,
  ),
}));
