import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { FamilyCondition } from '../entities/family-condition.entity';
import { FamilyConditionRepository } from '../repositories/family-condition.repository';
import { PatientRepository } from '../repositories/patient.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';
import {
  CreateFamilyConditionDto,
  UpdateFamilyConditionDto,
  FamilyConditionQueryDto,
  FamilyConditionResponseDto,
  PaginatedFamilyConditionsResponseDto,
  RelationshipType,
} from '../dto';

/**
 * Condition pattern for risk analysis
 */
interface ConditionPattern {
  condition: string;
  count: number;
  relationships: string[];
  averageOnsetAge?: number;
  riskMultiplier: number;
}

/**
 * Condition summary for generational analysis
 */
interface ConditionSummary {
  condition: string;
  count: number;
  relationships: string[];
}

/**
 * Pattern analysis result
 */
interface PatternAnalysisResult {
  patientId: string;
  totalConditions: number;
  uniqueConditions: number;
  affectedRelatives: number;
  riskProfile: {
    highRisk: ConditionPattern[];
    moderateRisk: ConditionPattern[];
    common: ConditionPattern[];
  };
  generationalPattern: {
    firstDegree: ConditionSummary[];
    secondDegree: ConditionSummary[];
    thirdDegree: ConditionSummary[];
  };
  recommendations: string[];
}

/**
 * Service for managing patient family medical history
 * Handles CRUD operations with HIPAA-compliant audit logging
 * Supports HL7 FHIR FamilyMemberHistory resource alignment
 * Provides hereditary pattern analysis and genetic risk assessment
 */
@Injectable()
export class FamilyConditionsService {
  // High-risk hereditary conditions
  private readonly HIGH_RISK_CONDITIONS = [
    'Breast Cancer', 'Ovarian Cancer', 'Colon Cancer', 'Prostate Cancer', 'Lung Cancer',
    'Heart Disease', 'Stroke', 'Hypertension', 'Coronary Heart Disease',
    'Diabetes', 'Type 1 Diabetes', 'Type 2 Diabetes',
    'Sickle Cell Anemia', 'Hemophilia', 'Huntington\'s Disease',
    'Alzheimer\'s Disease', 'Parkinson\'s Disease',
  ];

  // Moderate-risk conditions
  private readonly MODERATE_RISK_CONDITIONS = [
    'Asthma', 'Allergies', 'Eczema',
    'Depression', 'Anxiety', 'Bipolar Disorder',
    'Osteoporosis', 'Arthritis', 'Rheumatoid Arthritis',
    'Kidney Disease', 'Liver Disease',
  ];

  // Common tracked conditions
  private readonly COMMON_CONDITIONS = [
    'High Cholesterol', 'Obesity',
    'Thyroid Disorder', 'ADHD',
    'Migraine', 'Glaucoma',
  ];

  // Relationship degree mapping
  private readonly FIRST_DEGREE = ['Mother', 'Father', 'Child', 'Sibling'];
  private readonly SECOND_DEGREE = ['Grandparent', 'Grandmother', 'Grandfather', 'Aunt', 'Uncle', 'Half-Sibling', 'Grandchild', 'Niece', 'Nephew'];
  private readonly THIRD_DEGREE = ['Cousin', 'Great-Grandparent', 'Great-Aunt', 'Great-Uncle'];

  constructor(
    private readonly familyConditionRepository: FamilyConditionRepository,
    private readonly patientRepository: PatientRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('FamilyConditionsService');
  }

  /**
   * Create a new family condition entry with audit logging
   * @param dto Family condition data
   * @param userId User ID creating the entry
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created family condition
   */
  async create(
    dto: CreateFamilyConditionDto,
    userId: string,
    workspaceId: string,
  ): Promise<FamilyConditionResponseDto> {
    this.logger.log(`Creating family condition for patient: ${dto.patientId}, workspace: ${workspaceId}`);

    // Validate patient exists
    const patient = await this.patientRepository.findOne({
      where: { id: dto.patientId, workspaceId },
    });

    if (!patient) {
      this.logger.error(`Patient not found: ${dto.patientId}`);
      throw new NotFoundException(`Patient with ID ${dto.patientId} not found`);
    }

    // Business rule validation: Age of onset cannot be greater than current age
    if (dto.ageOfOnset !== undefined && dto.currentAge !== undefined && dto.ageOfOnset > dto.currentAge) {
      this.logger.error(`Invalid ages - onset: ${dto.ageOfOnset}, current: ${dto.currentAge}`);
      throw new BadRequestException('Age of onset cannot be greater than current age');
    }

    // Business rule validation: Cause of death requires isDeceased to be true
    if (dto.causeOfDeath && !dto.isDeceased) {
      this.logger.error('Cause of death provided without isDeceased flag');
      throw new BadRequestException('Cause of death requires isDeceased to be true');
    }

    // Store additional HL7/HIPAA fields in notes as structured JSON
    // (Entity migration needed to add dedicated columns for full HIPAA/HL7 compliance)
    let extendedNotes = dto.notes || '';
    const metadata: any = {};

    if (dto.snomedCode) metadata.snomedCode = dto.snomedCode;
    if (dto.ageOfOnset !== undefined) metadata.ageOfOnset = dto.ageOfOnset;
    if (dto.currentAge !== undefined) metadata.currentAge = dto.currentAge;
    if (dto.isDeceased !== undefined) metadata.isDeceased = dto.isDeceased;
    if (dto.causeOfDeath) metadata.causeOfDeath = dto.causeOfDeath;

    if (Object.keys(metadata).length > 0) {
      const metadataStr = `[METADATA]${JSON.stringify(metadata)}[/METADATA]`;
      extendedNotes = extendedNotes ? `${extendedNotes}\n\n${metadataStr}` : metadataStr;
    }

    // Create family condition entity
    const familyCondition = this.familyConditionRepository.create({
      condition: dto.condition,
      relation: dto.relationshipToPatient, // Map to legacy field name
      notes: extendedNotes,
      patientId: dto.patientId,
      workspaceId,
      userId,
    });

    try {
      // Save family condition to database
      const savedCondition = await this.familyConditionRepository.save(familyCondition);

      this.logger.log(`Family condition created successfully - ID: ${savedCondition.id}, patient: ${dto.patientId}`);

      // Audit log for CREATE_FAMILY_CONDITION (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_FAMILY_CONDITION',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'FamilyCondition',
            resourceId: savedCondition.id,
            patientId: dto.patientId,
            metadata: {
              condition: dto.condition,
              relationship: dto.relationshipToPatient,
              // Redact specific ages and identifying details per HIPAA
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for family condition creation - ID: ${savedCondition.id}`, auditError.stack);
      }

      return FamilyConditionResponseDto.fromEntity(savedCondition);
    } catch (error) {
      this.logger.error(`Failed to create family condition for patient: ${dto.patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find all family conditions with filters and pagination
   * @param query Query parameters with filters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Paginated family conditions
   */
  async findAll(
    query: FamilyConditionQueryDto,
    workspaceId: string,
  ): Promise<PaginatedFamilyConditionsResponseDto> {
    this.logger.log(`Finding all family conditions for workspace: ${workspaceId}`);

    try {
      const page = query.page || 1;
      const limit = Math.min(query.limit || 10, 100); // Max 100 per page

      let conditions: FamilyCondition[];
      let total: number;

      // Apply filters based on query
      if (query.patientId) {
        [conditions, total] = await this.familyConditionRepository.findByPatient(
          query.patientId,
          workspaceId,
          page,
          limit,
        );
      } else if (query.relationshipToPatient) {
        [conditions, total] = await this.familyConditionRepository.findByRelationship(
          query.relationshipToPatient,
          workspaceId,
          page,
          limit,
        );
      } else if (query.condition) {
        [conditions, total] = await this.familyConditionRepository.findByCondition(
          query.condition,
          workspaceId,
          page,
          limit,
        );
      } else if (query.searchTerm) {
        [conditions, total] = await this.familyConditionRepository.searchConditions(
          query.searchTerm,
          workspaceId,
          page,
          limit,
        );
      } else {
        // Get all active conditions
        [conditions, total] = await this.familyConditionRepository.findAndCount({
          where: { workspaceId, deletedAt: IsNull() },
          relations: ['patient'],
          skip: (page - 1) * limit,
          take: limit,
          order: { createdAt: 'DESC' },
        });
      }

      return {
        data: conditions.map((condition) => FamilyConditionResponseDto.fromEntity(condition)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find family conditions for workspace: ${workspaceId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find family conditions by patient ID with pagination
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated family conditions
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedFamilyConditionsResponseDto> {
    this.logger.log(`Finding family conditions by patient: ${patientId}, workspace: ${workspaceId}`);

    try {
      // Validate patient exists
      const patient = await this.patientRepository.findOne({
        where: { id: patientId, workspaceId },
      });

      if (!patient) {
        this.logger.error(`Patient not found: ${patientId}`);
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      const [conditions, total] = await this.familyConditionRepository.findByPatient(
        patientId,
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      // Audit log for VIEW_FAMILY_CONDITION (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_FAMILY_CONDITION',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'FamilyCondition',
            patientId,
            metadata: {
              count: conditions.length,
              page,
              limit,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for family condition view - patient: ${patientId}`, auditError.stack);
      }

      return {
        data: conditions.map((condition) => FamilyConditionResponseDto.fromEntity(condition)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find family conditions by patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Find single family condition by ID
   * @param id Family condition ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Single family condition
   */
  async findOne(id: string, workspaceId: string): Promise<FamilyConditionResponseDto> {
    this.logger.log(`Finding family condition by ID: ${id}, workspace: ${workspaceId}`);

    try {
      const condition = await this.familyConditionRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
        relations: ['patient'],
      });

      if (!condition) {
        this.logger.error(`Family condition not found: ${id}`);
        throw new NotFoundException(`Family condition with ID ${id} not found`);
      }

      // Audit log for VIEW_FAMILY_CONDITION (non-blocking, HIPAA requirement)
      try {
        await this.auditLogService.log(
          {
            userId: 'system', // Will be replaced by actual userId in controller
            action: 'VIEW_FAMILY_CONDITION',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'FamilyCondition',
            resourceId: id,
            patientId: condition.patientId,
            metadata: {
              condition: condition.condition,
              relationship: condition.relation,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for family condition view - ID: ${id}`, auditError.stack);
      }

      return FamilyConditionResponseDto.fromEntity(condition);
    } catch (error) {
      this.logger.error(`Failed to find family condition by ID: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Update a family condition entry
   * @param id Family condition ID
   * @param dto Update data
   * @param userId User ID performing the update
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Updated family condition
   */
  async update(
    id: string,
    dto: UpdateFamilyConditionDto,
    userId: string,
    workspaceId: string,
  ): Promise<FamilyConditionResponseDto> {
    this.logger.log(`Updating family condition: ${id}, workspace: ${workspaceId}`);

    try {
      const condition = await this.familyConditionRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
      });

      if (!condition) {
        this.logger.error(`Family condition not found: ${id}`);
        throw new NotFoundException(`Family condition with ID ${id} not found`);
      }

      // Extract existing metadata from notes
      const existingMetadata = this.extractMetadata(condition.notes);

      // Business rule validation: Age of onset cannot be greater than current age
      const newAgeOfOnset = dto.ageOfOnset ?? existingMetadata.ageOfOnset;
      const newCurrentAge = dto.currentAge ?? existingMetadata.currentAge;

      if (newAgeOfOnset !== undefined && newCurrentAge !== undefined && newAgeOfOnset > newCurrentAge) {
        this.logger.error(`Invalid ages - onset: ${newAgeOfOnset}, current: ${newCurrentAge}`);
        throw new BadRequestException('Age of onset cannot be greater than current age');
      }

      // Business rule validation: Cause of death requires isDeceased to be true
      const newIsDeceased = dto.isDeceased ?? existingMetadata.isDeceased;
      const newCauseOfDeath = dto.causeOfDeath ?? existingMetadata.causeOfDeath;

      if (newCauseOfDeath && !newIsDeceased) {
        this.logger.error('Cause of death provided without isDeceased flag');
        throw new BadRequestException('Cause of death requires isDeceased to be true');
      }

      // Merge metadata with updates
      const updatedMetadata = { ...existingMetadata };
      if (dto.snomedCode !== undefined) updatedMetadata.snomedCode = dto.snomedCode;
      if (dto.ageOfOnset !== undefined) updatedMetadata.ageOfOnset = dto.ageOfOnset;
      if (dto.currentAge !== undefined) updatedMetadata.currentAge = dto.currentAge;
      if (dto.isDeceased !== undefined) updatedMetadata.isDeceased = dto.isDeceased;
      if (dto.causeOfDeath !== undefined) updatedMetadata.causeOfDeath = dto.causeOfDeath;

      // Extract plain notes without metadata
      let plainNotes = this.extractPlainNotes(condition.notes);
      if (dto.notes !== undefined) {
        plainNotes = dto.notes;
      }

      // Reconstruct notes with metadata
      let extendedNotes = plainNotes || '';
      if (Object.keys(updatedMetadata).length > 0) {
        const metadataStr = `[METADATA]${JSON.stringify(updatedMetadata)}[/METADATA]`;
        extendedNotes = extendedNotes ? `${extendedNotes}\n\n${metadataStr}` : metadataStr;
      }

      // Update fields - map relationshipToPatient to legacy relation field
      if (dto.relationshipToPatient) {
        condition.relation = dto.relationshipToPatient;
      }
      if (dto.condition) {
        condition.condition = dto.condition;
      }

      condition.notes = extendedNotes;
      condition.userId = userId; // Track who last modified

      const updatedCondition = await this.familyConditionRepository.save(condition);

      this.logger.log(`Family condition updated successfully - ID: ${id}`);

      // Audit log for UPDATE_FAMILY_CONDITION (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_FAMILY_CONDITION',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'FamilyCondition',
            resourceId: id,
            patientId: condition.patientId,
            metadata: {
              updates: Object.keys(dto),
              condition: updatedCondition.condition,
              relationship: updatedCondition.relation,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for family condition update - ID: ${id}`, auditError.stack);
      }

      return FamilyConditionResponseDto.fromEntity(updatedCondition);
    } catch (error) {
      this.logger.error(`Failed to update family condition: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Soft delete a family condition entry
   * @param id Family condition ID
   * @param userId User ID performing the deletion
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Void
   */
  async remove(id: string, userId: string, workspaceId: string): Promise<void> {
    this.logger.log(`Deleting family condition: ${id}, workspace: ${workspaceId}`);

    try {
      const condition = await this.familyConditionRepository.findOne({
        where: { id, workspaceId, deletedAt: IsNull() },
      });

      if (!condition) {
        this.logger.error(`Family condition not found: ${id}`);
        throw new NotFoundException(`Family condition with ID ${id} not found`);
      }

      // Soft delete
      condition.deletedAt = new Date();
      await this.familyConditionRepository.save(condition);

      this.logger.log(`Family condition deleted successfully - ID: ${id}`);

      // Audit log for DELETE_FAMILY_CONDITION (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'DELETE_FAMILY_CONDITION',
            eventType: AuditEventType.DELETE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'FamilyCondition',
            resourceId: id,
            patientId: condition.patientId,
            metadata: {
              condition: condition.condition,
              relationship: condition.relation,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(`Failed to create audit log for family condition deletion - ID: ${id}`, auditError.stack);
      }
    } catch (error) {
      this.logger.error(`Failed to delete family condition: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Find family conditions by condition name with pagination
   * @param condition Condition name
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated family conditions
   */
  async findByCondition(
    condition: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedFamilyConditionsResponseDto> {
    this.logger.log(`Finding family conditions by condition: ${condition}, workspace: ${workspaceId}`);

    try {
      const [conditions, total] = await this.familyConditionRepository.findByCondition(
        condition,
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      return {
        data: conditions.map((condition) => FamilyConditionResponseDto.fromEntity(condition)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find family conditions by condition: ${condition}`, error.stack);
      throw error;
    }
  }

  /**
   * Find family conditions by relationship to patient with pagination
   * @param relationship Relationship type
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated family conditions
   */
  async findByRelationship(
    relationship: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedFamilyConditionsResponseDto> {
    this.logger.log(`Finding family conditions by relationship: ${relationship}, workspace: ${workspaceId}`);

    try {
      const [conditions, total] = await this.familyConditionRepository.findByRelationship(
        relationship,
        workspaceId,
        page,
        Math.min(limit, 100), // Max 100 per page
      );

      return {
        data: conditions.map((condition) => FamilyConditionResponseDto.fromEntity(condition)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to find family conditions by relationship: ${relationship}`, error.stack);
      throw error;
    }
  }

  /**
   * Get pattern analysis for a patient's family history
   * Analyzes hereditary patterns and provides genetic risk assessment
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Pattern analysis with risk assessment
   */
  async getPatternAnalysis(
    patientId: string,
    workspaceId: string,
  ): Promise<PatternAnalysisResult> {
    this.logger.log(`Generating pattern analysis for patient: ${patientId}`);

    try {
      // Validate patient exists
      const patient = await this.patientRepository.findOne({
        where: { id: patientId, workspaceId },
      });

      if (!patient) {
        this.logger.error(`Patient not found: ${patientId}`);
        throw new NotFoundException(`Patient with ID ${patientId} not found`);
      }

      // Get all family conditions for the patient
      const allConditions = await this.familyConditionRepository.find({
        where: { patientId, workspaceId, deletedAt: IsNull() },
      });

      // Get conditions by generation
      const generationalData = await this.familyConditionRepository.getConditionsByGeneration(
        patientId,
        workspaceId,
      );

      // Calculate basic statistics
      const totalConditions = allConditions.length;
      const uniqueConditions = new Set(allConditions.map(c => c.condition)).size;
      const affectedRelatives = new Set(allConditions.map(c => `${c.relation}-${c.patientId}`)).size;

      // Group conditions for pattern analysis
      const conditionMap = new Map<string, FamilyCondition[]>();
      allConditions.forEach(condition => {
        const existing = conditionMap.get(condition.condition) || [];
        existing.push(condition);
        conditionMap.set(condition.condition, existing);
      });

      // Categorize conditions by risk level
      const highRiskPatterns: ConditionPattern[] = [];
      const moderateRiskPatterns: ConditionPattern[] = [];
      const commonPatterns: ConditionPattern[] = [];

      conditionMap.forEach((conditions, conditionName) => {
        const pattern: ConditionPattern = {
          condition: conditionName,
          count: conditions.length,
          relationships: [...new Set(conditions.map(c => c.relation))],
          riskMultiplier: this.calculateRiskMultiplier(conditions),
        };

        // Calculate average onset age if available
        const onsetAges = conditions
          .map(c => {
            const metadata = this.extractMetadata(c.notes);
            return metadata.ageOfOnset;
          })
          .filter((age): age is number => age !== undefined && age !== null);

        if (onsetAges.length > 0) {
          pattern.averageOnsetAge = Math.round(
            onsetAges.reduce((sum, age) => sum + age, 0) / onsetAges.length
          );
        }

        // Categorize by risk level
        if (this.isHighRiskCondition(conditionName)) {
          highRiskPatterns.push(pattern);
        } else if (this.isModerateRiskCondition(conditionName)) {
          moderateRiskPatterns.push(pattern);
        } else {
          commonPatterns.push(pattern);
        }
      });

      // Sort patterns by risk multiplier (descending)
      highRiskPatterns.sort((a, b) => b.riskMultiplier - a.riskMultiplier);
      moderateRiskPatterns.sort((a, b) => b.riskMultiplier - a.riskMultiplier);
      commonPatterns.sort((a, b) => b.riskMultiplier - a.riskMultiplier);

      // Generate generational summaries
      const generationalPattern = {
        firstDegree: this.summarizeConditions(generationalData.firstDegree),
        secondDegree: this.summarizeConditions(generationalData.secondDegree),
        thirdDegree: this.summarizeConditions(generationalData.thirdDegree),
      };

      // Generate recommendations
      const recommendations = this.generateRecommendations(
        highRiskPatterns,
        moderateRiskPatterns,
        generationalPattern,
      );

      const result: PatternAnalysisResult = {
        patientId,
        totalConditions,
        uniqueConditions,
        affectedRelatives,
        riskProfile: {
          highRisk: highRiskPatterns,
          moderateRisk: moderateRiskPatterns,
          common: commonPatterns,
        },
        generationalPattern,
        recommendations,
      };

      this.logger.log(`Pattern analysis completed for patient: ${patientId}`);

      return result;
    } catch (error) {
      this.logger.error(`Failed to generate pattern analysis for patient: ${patientId}`, error.stack);
      throw error;
    }
  }

  /**
   * Extract metadata from notes field
   * @param notes Notes string with embedded metadata
   * @returns Parsed metadata object
   */
  private extractMetadata(notes?: string): any {
    if (!notes) return {};

    const metadataMatch = notes.match(/\[METADATA\](.*?)\[\/METADATA\]/s);
    if (metadataMatch && metadataMatch[1]) {
      try {
        return JSON.parse(metadataMatch[1]);
      } catch (error) {
        this.logger.error('Failed to parse metadata from notes', error.stack);
        return {};
      }
    }

    return {};
  }

  /**
   * Extract plain notes without metadata
   * @param notes Notes string with embedded metadata
   * @returns Plain notes string
   */
  private extractPlainNotes(notes?: string): string {
    if (!notes) return '';

    return notes.replace(/\[METADATA\].*?\[\/METADATA\]/s, '').trim();
  }

  /**
   * Calculate risk multiplier based on relationship degree and affected count
   * @param conditions Array of conditions
   * @returns Risk multiplier
   */
  private calculateRiskMultiplier(conditions: FamilyCondition[]): number {
    let multiplier = 1.0;

    conditions.forEach(condition => {
      if (this.FIRST_DEGREE.includes(condition.relation)) {
        multiplier += 2.0; // First-degree relatives have highest impact
      } else if (this.SECOND_DEGREE.includes(condition.relation)) {
        multiplier += 1.5; // Second-degree relatives
      } else if (this.THIRD_DEGREE.includes(condition.relation)) {
        multiplier += 1.2; // Third-degree relatives
      }

      // Early onset increases risk (before age 50)
      const metadata = this.extractMetadata(condition.notes);
      if (metadata.ageOfOnset && metadata.ageOfOnset < 50) {
        multiplier += 0.5;
      }
    });

    return Math.round(multiplier * 10) / 10; // Round to 1 decimal
  }

  /**
   * Check if condition is high-risk
   * @param condition Condition name
   * @returns True if high-risk
   */
  private isHighRiskCondition(condition: string): boolean {
    return this.HIGH_RISK_CONDITIONS.some(risk =>
      condition.toLowerCase().includes(risk.toLowerCase())
    );
  }

  /**
   * Check if condition is moderate-risk
   * @param condition Condition name
   * @returns True if moderate-risk
   */
  private isModerateRiskCondition(condition: string): boolean {
    return this.MODERATE_RISK_CONDITIONS.some(risk =>
      condition.toLowerCase().includes(risk.toLowerCase())
    );
  }

  /**
   * Summarize conditions for generational analysis
   * @param conditions Array of conditions
   * @returns Condition summaries
   */
  private summarizeConditions(conditions: FamilyCondition[]): ConditionSummary[] {
    const conditionMap = new Map<string, Set<string>>();

    conditions.forEach(condition => {
      const relationships = conditionMap.get(condition.condition) || new Set<string>();
      relationships.add(condition.relation);
      conditionMap.set(condition.condition, relationships);
    });

    return Array.from(conditionMap.entries()).map(([condition, relationships]) => ({
      condition,
      count: relationships.size,
      relationships: Array.from(relationships),
    }));
  }

  /**
   * Generate clinical recommendations based on risk analysis
   * @param highRisk High-risk patterns
   * @param moderateRisk Moderate-risk patterns
   * @param generational Generational pattern
   * @returns Array of recommendations
   */
  private generateRecommendations(
    highRisk: ConditionPattern[],
    moderateRisk: ConditionPattern[],
    generational: {
      firstDegree: ConditionSummary[];
      secondDegree: ConditionSummary[];
      thirdDegree: ConditionSummary[];
    },
  ): string[] {
    const recommendations: string[] = [];

    // High-risk recommendations
    if (highRisk.length > 0) {
      recommendations.push(
        'Genetic counseling recommended due to family history of hereditary conditions'
      );

      highRisk.forEach(pattern => {
        if (pattern.riskMultiplier >= 4.0) {
          recommendations.push(
            `Consider early screening for ${pattern.condition} - multiple affected first-degree relatives detected`
          );
        } else if (pattern.averageOnsetAge && pattern.averageOnsetAge < 50) {
          recommendations.push(
            `Early screening recommended for ${pattern.condition} - family history shows early onset (avg age ${pattern.averageOnsetAge})`
          );
        }
      });
    }

    // First-degree relative recommendations
    if (generational.firstDegree.length > 0) {
      const conditions = generational.firstDegree.map(c => c.condition).join(', ');
      recommendations.push(
        `Monitor closely for: ${conditions} (present in first-degree relatives)`
      );
    }

    // Multiple relatives with same condition
    const multipleAffected = [...highRisk, ...moderateRisk].filter(p => p.count >= 3);
    if (multipleAffected.length > 0) {
      recommendations.push(
        'Strong familial pattern detected - comprehensive genetic testing may be beneficial'
      );
    }

    // Lifestyle recommendations
    if (highRisk.some(p => p.condition.toLowerCase().includes('heart') || p.condition.toLowerCase().includes('diabetes'))) {
      recommendations.push(
        'Lifestyle modifications recommended: regular exercise, healthy diet, stress management'
      );
    }

    // Default recommendation if no specific risks
    if (recommendations.length === 0) {
      recommendations.push(
        'Continue routine health screenings and maintain a healthy lifestyle'
      );
    }

    return recommendations;
  }
}
