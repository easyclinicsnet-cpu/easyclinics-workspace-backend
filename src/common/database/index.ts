/**
 * Database Module - Enterprise Database Utilities
 *
 * This module provides core database functionality for the EMR system:
 *
 * 1. EncryptedRepository:
 *    - Automatic encryption/decryption of sensitive fields
 *    - Advanced search with Jaro-Winkler fuzzy matching
 *    - Result caching with 5-minute TTL
 *    - Batch processing for large datasets
 *    - Safe handling of circular references
 *
 * 2. EncryptionInterceptor:
 *    - HTTP-level encryption/decryption (placeholder for future implementation)
 *    - Request payload encryption
 *    - Response data encryption
 *
 * 3. TenantSchemaGuard:
 *    - Multi-tenancy workspace isolation
 *    - Workspace ID validation from JWT/headers/query
 *    - Security auditing and logging
 *
 * @module common/database
 */

// Repositories
export * from './repositories';

// Interceptors
export * from './interceptors';

// Guards
export * from './guards';

// Module
export { DatabaseModule } from './database.module';
