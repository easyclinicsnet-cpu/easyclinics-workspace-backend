import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { PatientInsurance } from '../entities/patient-insurance.entity';
import { PatientInsuranceRepository } from '../repositories/patient-insurance.repository';
import {
  CreatePatientInsuranceDto,
  UpdatePatientInsuranceDto,
  QueryPatientInsuranceDto,
  VerifyPatientInsuranceDto,
  PatientInsuranceResponseDto,
} from '../dtos';
import { IPaginatedResult } from '../interfaces';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

@Injectable()
export class PatientInsuranceService {
  private readonly context = PatientInsuranceService.name;

  constructor(
    private readonly patientInsuranceRepo: PatientInsuranceRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ==========================================================================
  // CREATE (Enrolment)
  // ==========================================================================

  async create(
    dto: CreatePatientInsuranceDto,
    workspaceId: string,
  ): Promise<PatientInsuranceResponseDto> {
    this.logger.log('Enrolling patient insurance', {
      context:     this.context,
      workspaceId,
      patientId:   dto.patientId,
    });

    // Enforce one insurance record per patient per workspace
    const existing = await this.patientInsuranceRepo.findByPatientId(dto.patientId, workspaceId);
    if (existing) {
      throw new ConflictException(
        `Patient ${dto.patientId} already has an insurance record in this workspace. Use PATCH to update it.`,
      );
    }

    const entity = this.dataSource.getRepository(PatientInsurance).create({
      ...dto,
      workspaceId,
      isActive:  true,
      isDeleted: false,
    });

    const saved = await this.dataSource.getRepository(PatientInsurance).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId,
        userId:       'system',
        action:       `Enrolled patient insurance for patient: ${dto.patientId}`,
        eventType:    AuditEventType.CREATE,
        outcome:      AuditOutcome.SUCCESS,
        resourceType: 'PatientInsurance',
        resourceId:   saved.id,
        newState:     { patientId: dto.patientId, membershipNumber: dto.membershipNumber },
      });
    } catch {
      this.logger.warn('Audit log failed for patient insurance creation', { context: this.context });
    }

    return PatientInsuranceResponseDto.fromEntity(saved);
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  async findAll(
    query: QueryPatientInsuranceDto,
    workspaceId: string,
  ): Promise<IPaginatedResult<PatientInsuranceResponseDto>> {
    const result = await this.patientInsuranceRepo.findWithFilters(query, workspaceId);
    return {
      data: result.data.map(PatientInsuranceResponseDto.fromEntity),
      meta: result.meta,
    };
  }

  async findById(id: string): Promise<PatientInsuranceResponseDto> {
    const entity = await this.patientInsuranceRepo.findByIdWithRelations(id);
    if (!entity) throw new NotFoundException(`Patient insurance record ${id} not found`);
    return PatientInsuranceResponseDto.fromEntity(entity);
  }

  async findByPatient(patientId: string, workspaceId: string): Promise<PatientInsuranceResponseDto> {
    const entity = await this.patientInsuranceRepo.findByPatientId(patientId, workspaceId);
    if (!entity) throw new NotFoundException(`No insurance record found for patient ${patientId}`);
    return PatientInsuranceResponseDto.fromEntity(entity);
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  async update(
    id: string,
    dto: UpdatePatientInsuranceDto,
    userId: string,
  ): Promise<PatientInsuranceResponseDto> {
    const entity = await this.patientInsuranceRepo.findOne({ where: { id, isDeleted: false } });
    if (!entity) throw new NotFoundException(`Patient insurance record ${id} not found`);

    const previousState = { membershipNumber: entity.membershipNumber, status: entity.status };
    Object.assign(entity, dto);
    const saved = await this.dataSource.getRepository(PatientInsurance).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId:  entity.workspaceId,
        userId,
        action:       `Updated patient insurance for patient: ${entity.patientId}`,
        eventType:    AuditEventType.UPDATE,
        outcome:      AuditOutcome.SUCCESS,
        resourceType: 'PatientInsurance',
        resourceId:   id,
        previousState,
        newState:     dto,
      });
    } catch {
      this.logger.warn('Audit log failed for patient insurance update', { context: this.context });
    }

    return PatientInsuranceResponseDto.fromEntity(saved);
  }

  // ==========================================================================
  // VERIFY
  // ==========================================================================

  /**
   * Records that a staff member has manually verified the patient's insurance details.
   */
  async verify(
    id: string,
    dto: VerifyPatientInsuranceDto,
    userId: string,
  ): Promise<PatientInsuranceResponseDto> {
    const entity = await this.patientInsuranceRepo.findOne({ where: { id, isDeleted: false } });
    if (!entity) throw new NotFoundException(`Patient insurance record ${id} not found`);

    entity.lastVerifiedDate  = new Date(dto.verifiedDate);
    entity.verifiedBy        = userId;
    entity.verificationNotes = dto.verificationNotes ?? entity.verificationNotes;

    const saved = await this.dataSource.getRepository(PatientInsurance).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId:  entity.workspaceId,
        userId,
        action:       `Verified patient insurance for patient: ${entity.patientId}`,
        eventType:    AuditEventType.UPDATE,
        outcome:      AuditOutcome.SUCCESS,
        resourceType: 'PatientInsurance',
        resourceId:   id,
        newState:     { verifiedDate: dto.verifiedDate, verifiedBy: userId },
      });
    } catch {
      this.logger.warn('Audit log failed for insurance verification', { context: this.context });
    }

    return PatientInsuranceResponseDto.fromEntity(saved);
  }

  // ==========================================================================
  // DELETE
  // ==========================================================================

  async softDelete(id: string, deletedBy: string): Promise<void> {
    const entity = await this.patientInsuranceRepo.findOne({ where: { id, isDeleted: false } });
    if (!entity) throw new NotFoundException(`Patient insurance record ${id} not found`);

    entity.isDeleted = true;
    entity.isActive  = false;
    entity.deletedBy = deletedBy;
    entity.deletedAt = new Date();

    await this.dataSource.getRepository(PatientInsurance).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId:  entity.workspaceId,
        userId:       deletedBy,
        action:       `Soft-deleted patient insurance record for patient: ${entity.patientId}`,
        eventType:    AuditEventType.DELETE,
        outcome:      AuditOutcome.SUCCESS,
        resourceType: 'PatientInsurance',
        resourceId:   id,
      });
    } catch {
      this.logger.warn('Audit log failed for patient insurance deletion', { context: this.context });
    }
  }
}
