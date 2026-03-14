import { registerAs } from '@nestjs/config';

/**
 * Encryption Configuration
 *
 * Defines encryption settings for AES-256-CBC field-level encryption.
 * Used by Aes256Service and EncryptedRepository base class.
 *
 * Environment Variables:
 * - ENCRYPTION_KEY: 256-bit encryption key (required, must be 32 bytes)
 * - ENCRYPTION_ROTATION_DAYS: Key rotation interval in days (optional, default: 90)
 *
 * Security Notes:
 * - ENCRYPTION_KEY should be unique per workspace (multi-tenancy)
 * - Store keys securely (e.g., AWS Secrets Manager, Azure Key Vault)
 * - Rotate keys according to compliance requirements (HIPAA: 90 days recommended)
 * - Never commit encryption keys to version control
 */
export default registerAs('encryption', () => ({
  /**
   * Unique per-workspace encryption key (from environment)
   * Must be 32 bytes (256 bits) for AES-256-CBC
   */
  key: process.env.ENCRYPTION_KEY,

  /**
   * Key rotation schedule (in days)
   * HIPAA compliance recommendation: 90 days
   * PCI-DSS requirement: 90-180 days
   */
  rotationInterval: parseInt(process.env.ENCRYPTION_ROTATION_DAYS || '90', 10),

  /**
   * Algorithm configuration
   * Using AES-256-CBC (Cipher Block Chaining)
   * - Industry standard for field-level encryption
   * - FIPS 140-2 compliant
   * - Suitable for healthcare data (HIPAA)
   */
  algorithm: 'aes-256-cbc' as const,

  /**
   * Initialization Vector (IV) length in bytes
   * AES block size is always 16 bytes (128 bits)
   */
  ivLength: 16,

  /**
   * Fields that should always be encrypted (regex patterns)
   * Used by EncryptedRepository to automatically identify sensitive fields
   *
   * Pattern Matching:
   * - /ssn/i: Social Security Numbers (e.g., ssn, nationalSSN)
   * - /medical/i: Medical information (e.g., medicalHistory, medicalAid)
   * - /health/i: Health data (e.g., healthInsurance, healthStatus)
   * - /diagnosis/i: Diagnostic information (e.g., diagnosis, diagnosisCode)
   * - /prescription/i: Prescription data (e.g., prescriptionDetails)
   * - /phone/i: Phone numbers (e.g., phoneNumber, mobilePhone)
   * - /email/i: Email addresses (e.g., email, contactEmail)
   * - /address/i: Physical addresses (e.g., address, homeAddress)
   * - /national/i: National identifiers (e.g., nationalId, nationalNumber)
   * - /passport/i: Passport information (e.g., passportNumber)
   */
  protectedFields: [
    /ssn/i,
    /medical/i,
    /health/i,
    /diagnosis/i,
    /prescription/i,
    /phone/i,
    /email/i,
    /address/i,
    /national/i,
    /passport/i,
    /birth/i, // birthDate, dateOfBirth
    /first.*name/i, // firstName, legalFirstName
    /last.*name/i, // lastName, legalLastName
    /member/i, // membershipNumber, memberId
  ],

  /**
   * Cache configuration for encrypted search
   * Used by EncryptedRepository.searchEncryptedFields()
   */
  cache: {
    /**
     * Cache Time-To-Live in milliseconds
     * Default: 5 minutes (300000 ms)
     */
    ttl: parseInt(process.env.ENCRYPTION_CACHE_TTL || '300000', 10),

    /**
     * Maximum number of cached search results
     * Uses LRU (Least Recently Used) eviction policy
     */
    maxSize: parseInt(process.env.ENCRYPTION_CACHE_MAX_SIZE || '100', 10),
  },

  /**
   * Batch processing configuration
   * Used by EncryptedRepository for large dataset operations
   */
  batch: {
    /**
     * Default batch size for encryption/decryption operations
     * Balances memory usage vs. performance
     */
    size: parseInt(process.env.ENCRYPTION_BATCH_SIZE || '100', 10),

    /**
     * Maximum number of entities to process in encrypted search
     * Prevents memory exhaustion on very large datasets
     */
    maxResults: parseInt(process.env.ENCRYPTION_MAX_RESULTS || '10000', 10),
  },

  /**
   * Fuzzy search configuration
   * Used by EncryptedRepository.searchEncryptedFields()
   */
  fuzzySearch: {
    /**
     * Jaro-Winkler similarity threshold (0.0 to 1.0)
     * Higher values = stricter matching
     * Recommended: 0.8 for general use, 0.9 for strict matching
     */
    threshold: parseFloat(process.env.ENCRYPTION_FUZZY_THRESHOLD || '0.8'),

    /**
     * Enable fuzzy search by default
     * Set to false to use exact matching only (better performance)
     */
    enabled: process.env.ENCRYPTION_FUZZY_ENABLED !== 'false',
  },
}));
