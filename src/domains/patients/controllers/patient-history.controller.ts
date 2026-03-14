/**
 * Patient History Controller — v1
 *
 * Enterprise-grade REST API for all patient medical history sub-domains:
 * medical history, surgical history, social history, and family conditions.
 *
 * ┌─ Contract ──────────────────────────────────────────────────────────────┐
 * │  100% DTO-validated inputs and typed responses                          │
 * │  workspaceId & userId always injected from the verified JWT             │
 * │  Composite endpoints (complete history, risk profile) available         │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌─ Versioning ────────────────────────────────────────────────────────────┐
 * │  Global prefix 'api/v1' → resolves at /api/v1/patient-history           │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌─ Security (applied in order) ───────────────────────────────────────────┐
 * │  WorkspaceJwtGuard — validates RS256 JWT, attaches req.user             │
 * │  RolesGuard        — role hierarchy enforcement                         │
 * │  PermissionsGuard  — fine-grained permission check                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Route map — Medical History:
 *   POST   /api/v1/patient-history/medical                      — create
 *   GET    /api/v1/patient-history/medical                      — list
 *   GET    /api/v1/patient-history/medical/patient/:patientId   — by patient
 *   GET    /api/v1/patient-history/medical/patient/:patientId/chronic — chronic conditions
 *   GET    /api/v1/patient-history/medical/:id                  — single
 *   PATCH  /api/v1/patient-history/medical/:id                  — update
 *   DELETE /api/v1/patient-history/medical/:id                  — soft delete
 *
 * Route map — Surgical History:
 *   POST   /api/v1/patient-history/surgical                     — create
 *   GET    /api/v1/patient-history/surgical                     — list
 *   GET    /api/v1/patient-history/surgical/patient/:patientId  — by patient
 *   GET    /api/v1/patient-history/surgical/complications       — with complications
 *   GET    /api/v1/patient-history/surgical/:id                 — single
 *   PATCH  /api/v1/patient-history/surgical/:id                 — update
 *   DELETE /api/v1/patient-history/surgical/:id                 — soft delete
 *
 * Route map — Social History:
 *   POST   /api/v1/patient-history/social                       — create / replace
 *   GET    /api/v1/patient-history/social/patient/:patientId    — by patient
 *   GET    /api/v1/patient-history/social/risk-patients         — high-risk list
 *   GET    /api/v1/patient-history/social/:id                   — single
 *   PATCH  /api/v1/patient-history/social/:id                   — update
 *   DELETE /api/v1/patient-history/social/:id                   — soft delete
 *
 * Route map — Family Conditions:
 *   POST   /api/v1/patient-history/family                        — create
 *   GET    /api/v1/patient-history/family                        — list
 *   GET    /api/v1/patient-history/family/patient/:patientId     — by patient
 *   GET    /api/v1/patient-history/family/patient/:patientId/pattern-analysis — genetic risk
 *   GET    /api/v1/patient-history/family/:id                    — single
 *   PATCH  /api/v1/patient-history/family/:id                    — update
 *   DELETE /api/v1/patient-history/family/:id                    — soft delete
 *
 * Route map — Composite:
 *   GET    /api/v1/patient-history/complete/:patientId           — all history types
 *   GET    /api/v1/patient-history/risk-profile/:patientId       — clinical risk assessment
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiParam,
  ApiQuery,
  ApiExtraModels,
} from '@nestjs/swagger';
import { Request } from 'express';

// Guards
import { WorkspaceJwtGuard } from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }        from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }  from '../../../common/security/auth/permissions.guard';

// Decorators
import { Roles } from '../../../common/security/auth/decorators';

// RBAC
import { UserRole } from '../../../common/enums';

// Services
import { PatientHistoryService } from '../services/patient-history.service';

// DTOs — Medical History
import {
  CreateMedicalHistoryDto,
  UpdateMedicalHistoryDto,
  MedicalHistoryResponseDto,
  MedicalHistoryQueryDto,
  PaginatedMedicalHistoryResponseDto,
} from '../dto/history';

// DTOs — Surgical History
import {
  CreateSurgicalHistoryDto,
  UpdateSurgicalHistoryDto,
  SurgicalHistoryResponseDto,
  SurgicalHistoryQueryDto,
  PaginatedSurgicalHistoryResponseDto,
} from '../dto/history';

// DTOs — Social History
import {
  CreateSocialHistoryDto,
  UpdateSocialHistoryDto,
  SocialHistoryResponseDto,
  SocialHistoryQueryDto,
  PaginatedSocialHistoryResponseDto,
} from '../dto/social-history';

// DTOs — Family Conditions
import {
  CreateFamilyConditionDto,
  UpdateFamilyConditionDto,
  FamilyConditionResponseDto,
  FamilyConditionQueryDto,
  PaginatedFamilyConditionsResponseDto,
} from '../dto/family-condition';

// ─────────────────────────────────────────────────────────────────────────────

/** Clinical roles that can read clinical history */
const HISTORY_READERS = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.PHARMACIST,
  UserRole.THERAPIST,
  UserRole.LAB_TECHNICIAN,
  UserRole.READ_ONLY,
] as const;

/** Clinical roles that can create / update clinical history records */
const HISTORY_WRITERS = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
] as const;

/** Roles that can delete clinical history records */
const HISTORY_DELETERS = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
] as const;

// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Patient History')
@ApiBearerAuth('JWT')
@ApiSecurity('WorkspaceId')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(
  CreateMedicalHistoryDto,
  UpdateMedicalHistoryDto,
  MedicalHistoryResponseDto,
  CreateSurgicalHistoryDto,
  UpdateSurgicalHistoryDto,
  SurgicalHistoryResponseDto,
  CreateSocialHistoryDto,
  UpdateSocialHistoryDto,
  SocialHistoryResponseDto,
  CreateFamilyConditionDto,
  UpdateFamilyConditionDto,
  FamilyConditionResponseDto,
)
@Controller({ path: 'patient-history', version: 'v1' })
export class PatientHistoryController {
  constructor(private readonly historyService: PatientHistoryService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // ── COMPOSITE ENDPOINTS  (declared first to avoid :patientId clash)  ──────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/patient-history/complete/:patientId
   * Returns all history types in a single response — optimised with Promise.all.
   */
  @Get('complete/:patientId')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patientHistory_complete',
    summary: 'Get complete patient history',
    description:
      'Returns all clinical history types for a patient in a single request: ' +
      'allergies, social history, medical conditions, surgical procedures, and family conditions. ' +
      'Fetched in parallel for performance. HIPAA-logged.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiResponse({ status: 200, description: 'Complete patient history object' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async getCompleteHistory(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Req() req: Request,
  ) {
    return this.historyService.getCompletePatientHistory(patientId, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/risk-profile/:patientId
   * Clinical risk assessment: allergies, social factors, chronic conditions, recent surgeries.
   */
  @Get('risk-profile/:patientId')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patientHistory_riskProfile',
    summary: 'Get patient clinical risk profile',
    description:
      'Assesses overall patient risk (MINIMAL / LOW / MODERATE / HIGH / CRITICAL) based on: ' +
      'severe allergy count, social risk factors (smoking/alcohol/drugs), ' +
      'chronic condition count, and recent surgeries (last 90 days). ' +
      'Returns risk score, factor breakdown, and clinical recommendations.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiResponse({ status: 200, description: 'Risk profile with factors and recommendations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async getRiskProfile(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Req() req: Request,
  ) {
    return this.historyService.getPatientRiskProfile(patientId, req.workspaceId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── MEDICAL HISTORY ───────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/patient-history/medical
   */
  @Post('medical')
  @Roles(...HISTORY_WRITERS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'medicalHistory_create',
    summary: 'Record past medical history',
    description:
      'Records a new past medical condition for a patient. ' +
      'Supports ICD-10/ICD-11 and SNOMED CT coding via the condition field. ' +
      'workspaceId and userId are injected from the JWT.',
  })
  @ApiResponse({ status: 201, description: 'Medical history created', type: MedicalHistoryResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async createMedical(
    @Body() dto: CreateMedicalHistoryDto,
    @Req() req: Request,
  ): Promise<MedicalHistoryResponseDto> {
    return this.historyService.createMedicalHistory(dto, req.userId, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/medical
   */
  @Get('medical')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medicalHistory_list',
    summary: 'List medical history records',
    description: 'Returns a paginated list of medical history records with optional filters.',
  })
  @ApiResponse({ status: 200, description: 'Paginated medical history', type: PaginatedMedicalHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAllMedical(
    @Query() query: MedicalHistoryQueryDto,
    @Req() req: Request,
  ): Promise<PaginatedMedicalHistoryResponseDto> {
    return this.historyService.findAllMedicalHistory(query, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/medical/patient/:patientId
   */
  @Get('medical/patient/:patientId')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medicalHistory_byPatient',
    summary: 'Get medical history by patient',
    description: 'Returns all medical history records for a specific patient, paginated.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiQuery({ name: 'page',  required: false, type: Number, example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({ status: 200, description: 'Patient medical history', type: PaginatedMedicalHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findMedicalByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedMedicalHistoryResponseDto> {
    return this.historyService.findPatientMedicalHistory(patientId, req.workspaceId, page, limit);
  }

  /**
   * GET /api/v1/patient-history/medical/patient/:patientId/chronic
   * Chronic conditions requiring ongoing management.
   */
  @Get('medical/patient/:patientId/chronic')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medicalHistory_chronic',
    summary: 'Get chronic conditions for patient',
    description:
      'Returns all chronic conditions for a patient that require ongoing clinical management. ' +
      'Used for care coordination and medication review workflows.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiResponse({ status: 200, description: 'Chronic conditions list', type: [MedicalHistoryResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findChronicConditions(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Req() req: Request,
  ): Promise<MedicalHistoryResponseDto[]> {
    return this.historyService.findPatientChronicConditions(patientId, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/medical/:id
   */
  @Get('medical/:id')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medicalHistory_getById',
    summary: 'Get medical history record by ID',
    description: 'Retrieves a single medical history record by its UUID.',
  })
  @ApiParam({ name: 'id', description: 'Medical history record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Medical history record', type: MedicalHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async findOneMedical(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<MedicalHistoryResponseDto> {
    return this.historyService.findOneMedicalHistory(id, req.workspaceId);
  }

  /**
   * PATCH /api/v1/patient-history/medical/:id
   */
  @Patch('medical/:id')
  @Roles(...HISTORY_WRITERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medicalHistory_update',
    summary: 'Update medical history record',
    description: 'Partially updates a medical history record.',
  })
  @ApiParam({ name: 'id', description: 'Medical history record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Updated record', type: MedicalHistoryResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async updateMedical(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMedicalHistoryDto,
    @Req() req: Request,
  ): Promise<MedicalHistoryResponseDto> {
    return this.historyService.updateMedicalHistory(id, dto, req.userId, req.workspaceId);
  }

  /**
   * DELETE /api/v1/patient-history/medical/:id
   */
  @Delete('medical/:id')
  @Roles(...HISTORY_DELETERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medicalHistory_delete',
    summary: 'Soft-delete medical history record',
    description: 'Soft-deletes a medical history record. Data is retained for HIPAA compliance.',
  })
  @ApiParam({ name: 'id', description: 'Medical history record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Record deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async removeMedical(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.historyService.removeMedicalHistory(id, req.userId, req.workspaceId);
    return { message: 'Medical history record deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SURGICAL HISTORY ──────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/patient-history/surgical
   * Future-date validation is enforced at the service layer.
   */
  @Post('surgical')
  @Roles(...HISTORY_WRITERS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'surgicalHistory_create',
    summary: 'Record past surgical history',
    description:
      'Records a new surgical procedure for a patient. ' +
      'Future surgery dates are rejected with a 400 error. ' +
      'Supports CPT and ICD-10-PCS procedure coding. ' +
      'workspaceId and userId are injected from the JWT.',
  })
  @ApiResponse({ status: 201, description: 'Surgical history created', type: SurgicalHistoryResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — future date not allowed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async createSurgical(
    @Body() dto: CreateSurgicalHistoryDto,
    @Req() req: Request,
  ): Promise<SurgicalHistoryResponseDto> {
    return this.historyService.createSurgicalHistory(dto, req.userId, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/surgical
   */
  @Get('surgical')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'surgicalHistory_list',
    summary: 'List surgical history records',
    description: 'Returns a paginated list of surgical history records with optional filters.',
  })
  @ApiResponse({ status: 200, description: 'Paginated surgical history', type: PaginatedSurgicalHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAllSurgical(
    @Query() query: SurgicalHistoryQueryDto,
    @Req() req: Request,
  ): Promise<PaginatedSurgicalHistoryResponseDto> {
    return this.historyService.findAllSurgicalHistory(query, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/surgical/complications
   * Workspace-wide list of surgeries that recorded complications.
   */
  @Get('surgical/complications')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'surgicalHistory_withComplications',
    summary: 'Get surgeries with complications',
    description:
      'Returns surgical records that have documented complications. ' +
      'Used for quality assurance, pre-operative risk review, and clinical audit.',
  })
  @ApiQuery({ name: 'page',  required: false, type: Number, example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: 'Surgeries with complications', type: PaginatedSurgicalHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findSurgicalWithComplications(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedSurgicalHistoryResponseDto> {
    return this.historyService.findSurgeriesWithComplications(req.workspaceId, page, limit);
  }

  /**
   * GET /api/v1/patient-history/surgical/patient/:patientId
   */
  @Get('surgical/patient/:patientId')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'surgicalHistory_byPatient',
    summary: 'Get surgical history by patient',
    description: 'Returns all surgical history records for a specific patient, paginated.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiQuery({ name: 'page',  required: false, type: Number, example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({ status: 200, description: 'Patient surgical history', type: PaginatedSurgicalHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findSurgicalByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedSurgicalHistoryResponseDto> {
    return this.historyService.findPatientSurgicalHistory(patientId, req.workspaceId, page, limit);
  }

  /**
   * GET /api/v1/patient-history/surgical/:id
   */
  @Get('surgical/:id')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'surgicalHistory_getById',
    summary: 'Get surgical history record by ID',
    description: 'Retrieves a single surgical history record by its UUID.',
  })
  @ApiParam({ name: 'id', description: 'Surgical history record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Surgical history record', type: SurgicalHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async findOneSurgical(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<SurgicalHistoryResponseDto> {
    return this.historyService.findOneSurgicalHistory(id, req.workspaceId);
  }

  /**
   * PATCH /api/v1/patient-history/surgical/:id
   */
  @Patch('surgical/:id')
  @Roles(...HISTORY_WRITERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'surgicalHistory_update',
    summary: 'Update surgical history record',
    description: 'Partially updates a surgical history record. Future dates are still rejected.',
  })
  @ApiParam({ name: 'id', description: 'Surgical history record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Updated record', type: SurgicalHistoryResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async updateSurgical(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSurgicalHistoryDto,
    @Req() req: Request,
  ): Promise<SurgicalHistoryResponseDto> {
    return this.historyService.updateSurgicalHistory(id, dto, req.userId, req.workspaceId);
  }

  /**
   * DELETE /api/v1/patient-history/surgical/:id
   */
  @Delete('surgical/:id')
  @Roles(...HISTORY_DELETERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'surgicalHistory_delete',
    summary: 'Soft-delete surgical history record',
    description: 'Soft-deletes a surgical history record.',
  })
  @ApiParam({ name: 'id', description: 'Surgical history record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Record deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async removeSurgical(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.historyService.removeSurgicalHistory(id, req.userId, req.workspaceId);
    return { message: 'Surgical history record deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── SOCIAL HISTORY  ───────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/patient-history/social
   * Creates a new social history record and soft-deletes any previous active record
   * (one active record per patient is enforced at the service layer).
   */
  @Post('social')
  @Roles(...HISTORY_WRITERS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'socialHistory_create',
    summary: 'Create / replace social history',
    description:
      'Creates a new social history record for a patient. ' +
      'The previous active record is automatically soft-deleted — ' +
      'only one active social history entry per patient is maintained. ' +
      'Records smoking status, alcohol use, drug use, occupation, and additional notes.',
  })
  @ApiResponse({ status: 201, description: 'Social history created', type: SocialHistoryResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async createSocial(
    @Body() dto: CreateSocialHistoryDto,
    @Req() req: Request,
  ): Promise<SocialHistoryResponseDto> {
    return this.historyService.createSocialHistory(dto, req.userId, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/social/risk-patients
   * Workspace patients with high social-risk factors (smoking, alcohol, drug use).
   */
  @Get('social/risk-patients')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'socialHistory_riskPatients',
    summary: 'Get high social-risk patients',
    description:
      'Returns patients with high-risk social history factors: ' +
      'current smokers, regular alcohol users, or current drug users. ' +
      'Used for proactive care planning and substance abuse referrals.',
  })
  @ApiQuery({ name: 'page',  required: false, type: Number, example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: 'High social-risk patients', type: PaginatedSocialHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findSocialRiskPatients(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedSocialHistoryResponseDto> {
    return this.historyService.findHighRiskPatients(req.workspaceId, page, limit);
  }

  /**
   * GET /api/v1/patient-history/social/patient/:patientId
   * The active social history record for a specific patient.
   */
  @Get('social/patient/:patientId')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'socialHistory_byPatient',
    summary: 'Get social history by patient',
    description: 'Returns the current active social history record for a patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiResponse({ status: 200, description: 'Active social history record', type: SocialHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'No social history found for patient' })
  async findSocialByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Req() req: Request,
  ): Promise<SocialHistoryResponseDto> {
    return this.historyService.findPatientSocialHistory(patientId, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/social/:id
   */
  @Get('social/:id')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'socialHistory_getById',
    summary: 'Get social history record by ID',
    description: 'Retrieves a single social history record by its UUID.',
  })
  @ApiParam({ name: 'id', description: 'Social history record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Social history record', type: SocialHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async findOneSocial(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<SocialHistoryResponseDto> {
    return this.historyService.findOneSocialHistory(id, req.workspaceId);
  }

  /**
   * PATCH /api/v1/patient-history/social/:id
   */
  @Patch('social/:id')
  @Roles(...HISTORY_WRITERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'socialHistory_update',
    summary: 'Update social history record',
    description: 'Partially updates a social history record.',
  })
  @ApiParam({ name: 'id', description: 'Social history record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Updated record', type: SocialHistoryResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async updateSocial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSocialHistoryDto,
    @Req() req: Request,
  ): Promise<SocialHistoryResponseDto> {
    return this.historyService.updateSocialHistory(id, dto, req.userId, req.workspaceId);
  }

  /**
   * DELETE /api/v1/patient-history/social/:id
   */
  @Delete('social/:id')
  @Roles(...HISTORY_DELETERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'socialHistory_delete',
    summary: 'Soft-delete social history record',
    description: 'Soft-deletes a social history record.',
  })
  @ApiParam({ name: 'id', description: 'Social history record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Record deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async removeSocial(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.historyService.removeSocialHistory(id, req.userId, req.workspaceId);
    return { message: 'Social history record deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── FAMILY CONDITIONS  ────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/patient-history/family
   * Business rules: ageOfOnset ≤ currentAge; causeOfDeath requires isDeceased=true.
   */
  @Post('family')
  @Roles(...HISTORY_WRITERS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'familyConditions_create',
    summary: 'Record family medical condition',
    description:
      'Records a hereditary medical condition for a family member of the patient. ' +
      'Follows HL7 v3 FamilyMemberHistory standard for relationship types and SNOMED CT for conditions. ' +
      'Business rules: ageOfOnset must be ≤ currentAge; causeOfDeath requires isDeceased=true.',
  })
  @ApiResponse({ status: 201, description: 'Family condition created', type: FamilyConditionResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — business rule violation' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async createFamily(
    @Body() dto: CreateFamilyConditionDto,
    @Req() req: Request,
  ): Promise<FamilyConditionResponseDto> {
    return this.historyService.createFamilyCondition(dto, req.userId, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/family
   */
  @Get('family')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'familyConditions_list',
    summary: 'List family condition records',
    description: 'Returns a paginated list of family condition records with optional filters.',
  })
  @ApiResponse({ status: 200, description: 'Paginated family conditions', type: PaginatedFamilyConditionsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAllFamily(
    @Query() query: FamilyConditionQueryDto,
    @Req() req: Request,
  ): Promise<PaginatedFamilyConditionsResponseDto> {
    return this.historyService.findAllFamilyConditions(query, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/family/patient/:patientId
   */
  @Get('family/patient/:patientId')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'familyConditions_byPatient',
    summary: 'Get family conditions by patient',
    description: 'Returns all family medical conditions for a specific patient, paginated.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiQuery({ name: 'page',  required: false, type: Number, example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({ status: 200, description: 'Patient family conditions', type: PaginatedFamilyConditionsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findFamilyByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedFamilyConditionsResponseDto> {
    return this.historyService.findPatientFamilyConditions(patientId, req.workspaceId, page, limit);
  }

  /**
   * GET /api/v1/patient-history/family/patient/:patientId/pattern-analysis
   * Genetic risk assessment with hereditary pattern detection.
   */
  @Get('family/patient/:patientId/pattern-analysis')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'familyConditions_patternAnalysis',
    summary: 'Genetic risk pattern analysis',
    description:
      'Analyses the patient\'s family medical history to detect hereditary patterns and assess genetic risk. ' +
      'Classifies conditions as high-risk (cancer, diabetes, heart disease) or moderate-risk. ' +
      'Considers generational proximity (first/second/third-degree relatives) and early-onset multipliers. ' +
      'Returns clinical recommendations aligned with HL7 FHIR FamilyMemberHistory.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiResponse({ status: 200, description: 'Genetic risk analysis with recommendations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async getFamilyPatternAnalysis(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Req() req: Request,
  ) {
    return this.historyService.getPatternAnalysis(patientId, req.workspaceId);
  }

  /**
   * GET /api/v1/patient-history/family/:id
   */
  @Get('family/:id')
  @Roles(...HISTORY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'familyConditions_getById',
    summary: 'Get family condition record by ID',
    description: 'Retrieves a single family condition record by its UUID.',
  })
  @ApiParam({ name: 'id', description: 'Family condition record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Family condition record', type: FamilyConditionResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async findOneFamily(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<FamilyConditionResponseDto> {
    return this.historyService.findOneFamilyCondition(id, req.workspaceId);
  }

  /**
   * PATCH /api/v1/patient-history/family/:id
   */
  @Patch('family/:id')
  @Roles(...HISTORY_WRITERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'familyConditions_update',
    summary: 'Update family condition record',
    description: 'Partially updates a family condition record. Business rules are re-validated.',
  })
  @ApiParam({ name: 'id', description: 'Family condition record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Updated record', type: FamilyConditionResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async updateFamily(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFamilyConditionDto,
    @Req() req: Request,
  ): Promise<FamilyConditionResponseDto> {
    return this.historyService.updateFamilyCondition(id, dto, req.userId, req.workspaceId);
  }

  /**
   * DELETE /api/v1/patient-history/family/:id
   */
  @Delete('family/:id')
  @Roles(...HISTORY_DELETERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'familyConditions_delete',
    summary: 'Soft-delete family condition record',
    description: 'Soft-deletes a family condition record.',
  })
  @ApiParam({ name: 'id', description: 'Family condition record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Record deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Record not found' })
  async removeFamily(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.historyService.removeFamilyCondition(id, req.userId, req.workspaceId);
    return { message: 'Family condition record deleted successfully' };
  }
}
