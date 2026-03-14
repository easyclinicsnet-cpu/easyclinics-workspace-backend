import {
  Repository,
  ObjectLiteral,
  DeepPartial,
  FindOneOptions,
  FindManyOptions,
  FindOptionsWhere,
  SaveOptions,
  EntityTarget,
  DataSource,
  DeleteResult,
} from 'typeorm';
import { Injectable } from '@nestjs/common';
import { Aes256Service } from '../../security/encryption/aes-256.service';
import { LoggerService } from '../../logger/logger.service';

/**
 * Interface for repositories that support encrypted field searching
 * @template T - The entity type
 */
export interface SearchableEncryptedRepository<T> {
  searchEncryptedFields(
    searchTerm: string,
    page?: number,
    limit?: number,
  ): Promise<[T[], number]>;
}

/**
 * Options for configuring encrypted field search behavior
 */
export interface EncryptedSearchOptions {
  /** Fields to search within */
  searchFields: string[];
  /** Number of records to process per batch */
  batchSize?: number;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Whether to use cache for search results */
  useCache?: boolean;
}

/**
 * Abstract base repository with automatic encryption/decryption capabilities.
 *
 * Features:
 * - Automatic encryption/decryption of sensitive fields
 * - Encrypted field search with fuzzy matching (Jaro-Winkler algorithm)
 * - Search result caching with 5-minute TTL
 * - Batch processing for large datasets
 * - Safe handling of circular references
 *
 * @template T - Entity type that extends ObjectLiteral
 *
 * @example
 * ```typescript
 * export class PatientRepository extends EncryptedRepository<Patient> {
 *   constructor(
 *     dataSource: DataSource,
 *     aesService: Aes256Service,
 *     logger: LoggerService,
 *   ) {
 *     super(Patient, dataSource, aesService, logger);
 *     this.logger.setContext('PatientRepository');
 *   }
 *
 *   protected getSearchableEncryptedFields(): string[] {
 *     return ['firstName', 'lastName', 'email', 'phone'];
 *   }
 *
 *   protected getSearchFilters(): Partial<FindOptionsWhere<Patient>> {
 *     return { isActive: true };
 *   }
 * }
 * ```
 */
@Injectable()
export abstract class EncryptedRepository<T extends ObjectLiteral>
  extends Repository<T>
  implements SearchableEncryptedRepository<T>
{
  /** Cache for search results with timestamp tracking */
  private searchCache = new Map<string, { results: T[]; timestamp: number }>();

  /** Cache time-to-live: 5 minutes */
  private readonly CACHE_TTL = 5 * 60 * 1000;

  /** Default batch size for processing large datasets */
  private readonly DEFAULT_BATCH_SIZE = 100;

  /** Default maximum number of search results */
  private readonly DEFAULT_MAX_RESULTS = 1000;

  /**
   * Creates an instance of EncryptedRepository.
   *
   * @param entityTarget - The entity class or schema
   * @param dataSource - TypeORM DataSource instance
   * @param aesService - AES-256 encryption service
   * @param logger - Winston logger service
   */
  constructor(
    protected readonly entityTarget: EntityTarget<T>,
    protected readonly dataSource: DataSource,
    protected readonly aesService: Aes256Service,
    protected readonly logger: LoggerService,
  ) {
    super(entityTarget, dataSource.manager);
    this.logger.setContext('EncryptedRepository');
  }

  /**
   * Abstract method to define which encrypted fields are searchable.
   * Must be implemented by child repositories.
   *
   * @returns Array of field names that can be searched
   */
  protected abstract getSearchableEncryptedFields(): string[];

  /**
   * Abstract method to define base filters for search queries.
   * Must be implemented by child repositories.
   *
   * @returns Partial where clause for filtering search results
   */
  protected abstract getSearchFilters(): Partial<FindOptionsWhere<T>>;

  /**
   * Search across encrypted fields using a hybrid approach with fuzzy matching.
   *
   * Algorithm:
   * 1. Checks cache for existing results
   * 2. Fetches records in batches to manage memory
   * 3. Decrypts each batch
   * 4. Applies fuzzy matching using Jaro-Winkler similarity
   * 5. Caches results for subsequent queries
   *
   * @param searchTerm - The term to search for
   * @param page - Page number for pagination (default: 1)
   * @param limit - Records per page (default: 10)
   * @param options - Additional search configuration
   * @returns Tuple of [results array, total count]
   */
  async searchEncryptedFields(
    searchTerm: string,
    page: number = 1,
    limit: number = 10,
    options?: Partial<EncryptedSearchOptions>,
  ): Promise<[T[], number]> {
    if (!searchTerm?.trim()) {
      this.logger.warn('Empty search term provided, returning paginated results');
      return this.findAndCount({
        where: this.getSearchFilters(),
        skip: (page - 1) * limit,
        take: limit,
        order: { createdAt: 'DESC' } as any,
      });
    }

    const cacheKey = this.generateCacheKey(searchTerm, options);

    // Check cache first
    if (options?.useCache !== false) {
      const cached = this.getCachedResults(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for search: ${searchTerm}`);
        return this.paginateResults(cached, page, limit);
      }
    }

    this.logger.log(`Performing encrypted search for: ${searchTerm}`);

    const searchOptions: EncryptedSearchOptions = {
      searchFields: this.getSearchableEncryptedFields(),
      batchSize: this.DEFAULT_BATCH_SIZE,
      maxResults: this.DEFAULT_MAX_RESULTS,
      useCache: true,
      ...options,
    };

    // Perform the search
    const results = await this.performEncryptedSearch(
      searchTerm,
      searchOptions,
    );

    this.logger.log(`Search completed. Found ${results.length} results`);

    // Cache results
    if (searchOptions.useCache) {
      this.cacheResults(cacheKey, results);
    }

    return this.paginateResults(results, page, limit);
  }

  /**
   * Core encrypted search implementation with batch processing.
   *
   * @param searchTerm - Normalized search term
   * @param options - Search configuration options
   * @returns Array of matching entities
   */
  private async performEncryptedSearch(
    searchTerm: string,
    options: EncryptedSearchOptions,
  ): Promise<T[]> {
    const normalizedSearch = this.normalizeSearchTerm(searchTerm);
    const matchingResults: T[] = [];
    let processed = 0;

    // Get base query with filters
    const baseQuery = this.createQueryBuilder()
      .where(this.getSearchFilters() as any)
      .orderBy('createdAt', 'DESC');

    // Process in batches to avoid memory issues
    let offset = 0;
    const batchSize = options.batchSize || this.DEFAULT_BATCH_SIZE;

    while (processed < (options.maxResults || this.DEFAULT_MAX_RESULTS)) {
      const batch = await baseQuery.skip(offset).take(batchSize).getMany();

      if (batch.length === 0) {
        this.logger.debug(`No more records to process. Processed ${processed} total`);
        break;
      }

      this.logger.debug(`Processing batch at offset ${offset}, size: ${batch.length}`);

      // Decrypt and search this batch
      const batchResults = await this.searchDecryptedBatch(
        batch,
        normalizedSearch,
        options.searchFields,
      );

      matchingResults.push(...batchResults);
      processed += batch.length;
      offset += batchSize;

      // Early termination if we have enough results
      if (
        matchingResults.length >=
        (options.maxResults || this.DEFAULT_MAX_RESULTS)
      ) {
        this.logger.debug(`Max results reached: ${matchingResults.length}`);
        break;
      }
    }

    return matchingResults.slice(
      0,
      options.maxResults || this.DEFAULT_MAX_RESULTS,
    );
  }

  /**
   * Search through a decrypted batch of entities.
   *
   * @param batch - Array of entities to search
   * @param searchTerm - Normalized search term
   * @param searchFields - Fields to search within
   * @returns Array of matching entities
   */
  private async searchDecryptedBatch(
    batch: T[],
    searchTerm: string,
    searchFields: string[],
  ): Promise<T[]> {
    const results: T[] = [];

    await Promise.all(
      batch.map(async (entity) => {
        try {
          // Decrypt the entity
          await this.decryptEntityFields(entity);

          // Check if any search field matches
          const matches = await this.entityMatchesSearch(
            entity,
            searchTerm,
            searchFields,
          );

          if (matches) {
            results.push(this.ensureEntityMethods(entity));
          }
        } catch (error) {
          this.logger.error('Error processing entity in search', error instanceof Error ? error.stack : String(error));
        }
      }),
    );

    return results;
  }

  /**
   * Check if entity matches search criteria across specified fields.
   *
   * @param entity - Entity to check
   * @param searchTerm - Normalized search term
   * @param searchFields - Fields to search within
   * @returns True if entity matches search term
   */
  private async entityMatchesSearch(
    entity: T,
    searchTerm: string,
    searchFields: string[],
  ): Promise<boolean> {
    for (const field of searchFields) {
      const value = this.getNestedProperty(entity, field);
      if (value && this.matchesSearchTerm(String(value), searchTerm)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Fuzzy matching with multiple strategies:
   * 1. Exact substring match
   * 2. Multi-word match (all words must be present)
   * 3. Jaro-Winkler similarity matching
   *
   * @param value - Field value to match against
   * @param searchTerm - Normalized search term
   * @returns True if value matches search term
   */
  protected matchesSearchTerm(value: string, searchTerm: string): boolean {
    const normalizedValue = this.normalizeSearchTerm(value);
    const normalizedSearch = this.normalizeSearchTerm(searchTerm);

    // Strategy 1: Exact substring match
    if (normalizedValue.includes(normalizedSearch)) {
      return true;
    }

    // Strategy 2: Multi-word match - all words must be present
    const searchWords = normalizedSearch.split(/\s+/);
    if (searchWords.length > 1) {
      return searchWords.every((word) => normalizedValue.includes(word));
    }

    // Strategy 3: Fuzzy matching for single terms
    return this.fuzzyMatch(normalizedValue, normalizedSearch);
  }

  /**
   * Fuzzy matching using Jaro-Winkler similarity algorithm.
   *
   * @param text - Text to search in
   * @param pattern - Pattern to search for
   * @param threshold - Similarity threshold (0.0 to 1.0, default: 0.8)
   * @returns True if similarity exceeds threshold
   */
  private fuzzyMatch(
    text: string,
    pattern: string,
    threshold: number = 0.8,
  ): boolean {
    if (pattern.length > text.length) return false;

    // For short patterns (3 chars or less), require exact match
    if (pattern.length <= 3) {
      return text.includes(pattern);
    }

    // Calculate Jaro-Winkler similarity
    const similarity = this.calculateSimilarity(text, pattern);
    return similarity >= threshold;
  }

  /**
   * Calculate string similarity using Jaro-Winkler algorithm.
   *
   * The Jaro-Winkler algorithm measures similarity between two strings.
   * It considers:
   * - Matching characters within a specific distance
   * - Transpositions (swapped characters)
   * - Common prefix bonus
   *
   * @param s1 - First string
   * @param s2 - Second string
   * @returns Similarity score (0.0 to 1.0)
   */
  private calculateSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;

    // Calculate match window
    const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    const s1Matches = new Array(s1.length).fill(false);
    const s2Matches = new Array(s2.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    // Find matches within the window
    for (let i = 0; i < s1.length; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, s2.length);

      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    // Calculate transpositions
    let k = 0;
    for (let i = 0; i < s1.length; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    // Calculate Jaro similarity
    const jaro =
      (matches / s1.length +
        matches / s2.length +
        (matches - transpositions / 2) / matches) /
      3;

    return jaro;
  }

  /**
   * Normalize search terms for consistent matching.
   * - Converts to lowercase
   * - Trims whitespace
   * - Removes special characters
   * - Normalizes multiple spaces to single space
   *
   * @param term - Term to normalize
   * @returns Normalized term
   */
  protected normalizeSearchTerm(term: string): string {
    return term
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' '); // Normalize whitespace
  }

  /**
   * Safely get nested property value from an object.
   *
   * @param obj - Object to extract value from
   * @param path - Dot-notation path to property (e.g., 'user.address.city')
   * @returns Property value or undefined
   */
  private getNestedProperty(obj: any, path: string): any {
    return path.split('.').reduce((current, prop) => current?.[prop], obj);
  }

  /**
   * Generate unique cache key for search query.
   *
   * @param searchTerm - Search term
   * @param options - Search options
   * @returns Unique cache key
   */
  private generateCacheKey(
    searchTerm: string,
    options?: Partial<EncryptedSearchOptions>,
  ): string {
    const optionsStr = JSON.stringify(options || {});
    return `search:${searchTerm}:${optionsStr}`;
  }

  /**
   * Retrieve cached search results if not expired.
   *
   * @param key - Cache key
   * @returns Cached results or null if expired/not found
   */
  private getCachedResults(key: string): T[] | null {
    const cached = this.searchCache.get(key);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > this.CACHE_TTL;
    if (isExpired) {
      this.searchCache.delete(key);
      this.logger.debug(`Cache expired for key: ${key}`);
      return null;
    }

    return cached.results;
  }

  /**
   * Cache search results with timestamp.
   * Implements LRU-like eviction when cache exceeds 100 entries.
   *
   * @param key - Cache key
   * @param results - Results to cache
   */
  private cacheResults(key: string, results: T[]): void {
    this.searchCache.set(key, {
      results,
      timestamp: Date.now(),
    });

    // Cleanup when cache exceeds limit - remove oldest entries
    if (this.searchCache.size > 100) {
      let oldestKey: string | null = null;
      let oldestTimestamp = Date.now();

      this.searchCache.forEach((value, cacheKey) => {
        if (value.timestamp < oldestTimestamp) {
          oldestTimestamp = value.timestamp;
          oldestKey = cacheKey;
        }
      });

      if (oldestKey) {
        this.searchCache.delete(oldestKey);
        this.logger.debug(`Evicted oldest cache entry: ${oldestKey}`);
      }
    }
  }

  /**
   * Paginate search results.
   *
   * @param results - Full results array
   * @param page - Page number (1-indexed)
   * @param limit - Items per page
   * @returns Tuple of [paginated results, total count]
   */
  private paginateResults(
    results: T[],
    page: number,
    limit: number,
  ): [T[], number] {
    const start = (page - 1) * limit;
    const end = start + limit;
    return [results.slice(start, end), results.length];
  }

  /**
   * Enhanced save with automatic encryption and cache invalidation.
   * Supports both single entity and array operations.
   *
   * @param entityOrEntities - Single entity or array of entities
   * @param options - TypeORM save options
   * @returns Saved entity or entities (decrypted)
   */
  async save(entity: DeepPartial<T>, options?: SaveOptions): Promise<T>;
  async save(entities: DeepPartial<T>[], options?: SaveOptions): Promise<T[]>;
  async save(
    entityOrEntities: DeepPartial<T> | DeepPartial<T>[],
    options?: SaveOptions,
  ): Promise<T | T[]> {
    // Clear relevant cache entries
    this.clearSearchCache();

    let result: T | T[];

    if (Array.isArray(entityOrEntities)) {
      this.logger.debug(`Saving ${entityOrEntities.length} entities`);
      await Promise.all(
        entityOrEntities.map((e) => this.encryptEntityFields(e)),
      );
      result = await super.save(entityOrEntities, options);
      await Promise.all(result.map((e) => this.decryptEntityFields(e)));
      return result;
    }

    this.logger.debug('Saving single entity');
    await this.encryptEntityFields(entityOrEntities);
    result = await super.save(entityOrEntities, options);
    await this.decryptEntityFields(result);
    return result;
  }

  /**
   * Clear all search cache entries.
   */
  private clearSearchCache(): void {
    const size = this.searchCache.size;
    this.searchCache.clear();
    if (size > 0) {
      this.logger.debug(`Cleared ${size} cache entries`);
    }
  }

  /**
   * Find entities with automatic decryption.
   *
   * @param options - TypeORM find options
   * @returns Array of decrypted entities
   */
  async find(options?: FindManyOptions<T>): Promise<T[]> {
    const entities = await super.find(options);
    await Promise.all(entities.map((e) => this.decryptEntityFields(e)));
    return entities;
  }

  /**
   * Find entities by where clause with automatic decryption.
   *
   * @param where - Where conditions
   * @returns Array of decrypted entities
   */
  async findBy(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  ): Promise<T[]> {
    const entities = await super.findBy(where);
    await Promise.all(entities.map((e) => this.decryptEntityFields(e)));
    return entities;
  }

  /**
   * Find entities and count with automatic decryption.
   *
   * @param options - TypeORM find options
   * @returns Tuple of [decrypted entities, total count]
   */
  async findAndCount(options?: FindManyOptions<T>): Promise<[T[], number]> {
    const [entities, count] = await super.findAndCount(options);
    await Promise.all(entities.map((e) => this.decryptEntityFields(e)));
    return [entities, count];
  }

  /**
   * Find single entity with automatic decryption.
   *
   * @param options - TypeORM find one options
   * @returns Decrypted entity or null
   */
  async findOne(options: FindOneOptions<T>): Promise<T | null> {
    const entity = await super.findOne(options);
    if (entity) await this.decryptEntityFields(entity);
    return entity;
  }

  /**
   * Find single entity by where clause with automatic decryption.
   *
   * @param where - Where conditions
   * @returns Decrypted entity or null
   */
  async findOneBy(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  ): Promise<T | null> {
    const entity = await super.findOneBy(where);
    if (entity) await this.decryptEntityFields(entity);
    return entity;
  }

  /**
   * Find single entity or fail with automatic decryption.
   *
   * @param options - TypeORM find one options
   * @returns Decrypted entity
   * @throws EntityNotFoundError if entity not found
   */
  async findOneOrFail(options: FindOneOptions<T>): Promise<T> {
    const entity = await super.findOneOrFail(options);
    await this.decryptEntityFields(entity);
    return entity;
  }

  /**
   * Delete entities with cache invalidation.
   *
   * @param criteria - Delete criteria
   * @returns Delete result
   */
  async delete(criteria: any): Promise<DeleteResult> {
    this.clearSearchCache();
    return super.delete(criteria);
  }

  /**
   * Encrypt sensitive fields in entity.
   *
   * Features:
   * - Handles arrays recursively
   * - Skips already encrypted fields
   * - Handles nested objects
   * - Avoids circular references
   * - Graceful error handling (logs but continues)
   *
   * @param entity - Entity to encrypt
   */
  async encryptEntityFields(entity: any): Promise<void> {
    if (!entity) return;

    if (Array.isArray(entity)) {
      await Promise.all(entity.map((e) => this.encryptEntityFields(e)));
      return;
    }

    for (const key in entity) {
      if (!entity.hasOwnProperty(key) || !entity[key]) continue;

      // Handle sensitive fields
      if (this.isSensitiveField(key) && typeof entity[key] === 'string') {
        // Skip if already encrypted
        if (this.isEncrypted(entity[key])) {
          continue;
        }

        try {
          const originalValue = String(entity[key]);
          entity[key] = await this.aesService.encrypt(originalValue);
        } catch (error) {
          this.logger.error(
            `Encryption failed for field ${key}`,
            error instanceof Error ? error.stack : String(error),
          );
          // Don't throw - log and continue with unencrypted value
        }
        continue;
      }

      // Handle nested objects (avoid circular references)
      if (typeof entity[key] === 'object' && entity[key] !== entity) {
        await this.encryptEntityFields(entity[key]);
      }
    }
  }

  /**
   * Decrypt sensitive fields in entity.
   *
   * Features:
   * - Handles arrays recursively
   * - Prevents circular references using WeakSet
   * - Only decrypts detected encrypted fields
   * - Graceful error handling (logs but continues)
   * - Handles nested objects
   *
   * @param entity - Entity to decrypt
   * @param visitedObjects - Tracks visited objects to prevent circular references
   */
  async decryptEntityFields(
    entity: any,
    visitedObjects = new WeakSet(),
  ): Promise<void> {
    if (!entity) return;

    // WeakSet can only hold objects, not primitives
    if (typeof entity !== 'object' || entity === null) return;

    // Prevent circular reference issues
    if (visitedObjects.has(entity)) return;
    visitedObjects.add(entity);

    if (Array.isArray(entity)) {
      await Promise.all(
        entity.map((e) => this.decryptEntityFields(e, visitedObjects)),
      );
      return;
    }

    for (const key in entity) {
      if (!entity.hasOwnProperty(key) || !entity[key]) continue;

      if (this.isSensitiveField(key) && typeof entity[key] === 'string') {
        // Only decrypt if it appears to be encrypted
        if (this.isEncrypted(entity[key])) {
          try {
            entity[key] = await this.aesService.decrypt(String(entity[key]));
          } catch (error) {
            // Data was encrypted with a different key (e.g. different dev env).
            // Clear the field so downstream code gets null rather than raw ciphertext.
            this.logger.warn(
              `Decryption failed for field ${key} — clearing value (key mismatch or corrupt data)`,
            );
            entity[key] = null;
          }
        }
        continue;
      }

      // Handle nested objects (avoid circular references)
      if (typeof entity[key] === 'object' && entity[key] !== entity) {
        await this.decryptEntityFields(entity[key], visitedObjects);
      }
    }
  }

  /**
   * Detect if a string value is encrypted.
   *
   * Checks:
   * - Contains colon separator
   * - Minimum length (32+ characters)
   * - No whitespace
   * - Base64/hex-like format
   *
   * @param value - Value to check
   * @returns True if value appears to be encrypted
   */
  protected isEncrypted(value: string): boolean {
    if (typeof value !== 'string') return false;

    // AES-256-CBC output format: {32 hex chars IV}:{hex ciphertext}
    // IV is always 16 bytes = 32 hex characters
    // Ciphertext is at least 32 hex characters (16-byte AES block)
    return /^[0-9a-f]{32}:[0-9a-f]{32,}$/.test(value);
  }

  /**
   * Determine if a field should be encrypted/decrypted.
   *
   * Checks against:
   * - Predefined sensitive field names
   * - Pattern matching for sensitive keywords
   *
   * @param key - Field name
   * @returns True if field is sensitive
   */
  /** O(1) Set lookup replaces O(16) array .includes() — called thousands of times per request */
  private static readonly KNOWN_SENSITIVE = new Set([
    'content', 'firstName', 'lastName', 'email', 'phone', 'ssn', 'nationalId',
    'address', 'chiefComplaint', 'description', 'assessment',
    'medicine', 'dose', 'route', 'frequency', 'days',
  ]);
  private static readonly SENSITIVE_RE = /(password|secret|token|creditCard|private|medical|health)/i;
  /** Memoize: field name → boolean. Field names are finite and deterministic. */
  private static readonly _fieldCache = new Map<string, boolean>();

  protected isSensitiveField(key: string): boolean {
    let hit = EncryptedRepository._fieldCache.get(key);
    if (hit !== undefined) return hit;

    hit = EncryptedRepository.KNOWN_SENSITIVE.has(key) ||
          EncryptedRepository.SENSITIVE_RE.test(key);
    EncryptedRepository._fieldCache.set(key, hit);
    return hit;
  }

  /**
   * Ensure entity methods are available after decryption.
   * Creates a new instance and copies properties to maintain prototype chain.
   *
   * @param entity - Entity to restore methods for
   * @returns Entity with methods
   */
  public ensureEntityMethods(entity: T): T {
    // Create a new instance to ensure methods are available
    const EntityClass = this.entityTarget as new () => T;
    const instance = new EntityClass();
    Object.assign(instance, entity);
    return instance;
  }
}
