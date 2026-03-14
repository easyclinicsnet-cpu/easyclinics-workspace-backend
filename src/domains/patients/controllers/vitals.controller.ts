/**
 * Vitals Controller — v1
 *
 * Enterprise-grade REST API for patient vital signs management.
 *
 * ┌─ Contract ──────────────────────────────────────────────────────────────┐
 * │  100% DTO-validated inputs and typed responses                          │
 * │  workspaceId & userId always injected from the verified JWT             │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌─ Versioning ────────────────────────────────────────────────────────────┐
 * │  Global prefix 'api/v1' (set in main.ts) → resolves at /api/v1/vitals  │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌─ Security (applied in order) ───────────────────────────────────────────┐
 * │  WorkspaceJwtGuard — validates RS256 JWT, attaches req.user             │
 * │  RolesGuard        — role hierarchy enforcement                         │
 * │  PermissionsGuard  — fine-grained permission check                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Route map:
 *   POST   /api/v1/vitals                                    — record vitals
 *   GET    /api/v1/vitals                                    — list with filters
 *   GET    /api/v1/vitals/patient/:patientId                 — vitals by patient
 *   GET    /api/v1/vitals/appointment/:appointmentId         — vitals by appointment
 *   GET    /api/v1/vitals/appointment/:appointmentId/latest  — most recent vital
 *   GET    /api/v1/vitals/:id                                — single vital
 *   PATCH  /api/v1/vitals/:id                                — update vital
 *   DELETE /api/v1/vitals/:id                                — soft delete
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
import { VitalsService } from '../services/vitals.service';

// DTOs
import {
  CreateVitalDto,
  UpdateVitalDto,
  VitalResponseDto,
  VitalQueryDto,
  PaginatedVitalsResponseDto,
} from '../dto/vital';

// ─────────────────────────────────────────────────────────────────────────────

/** Clinical roles that can read vital signs */
const VITAL_READERS = [
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
  UserRole.SCHEDULER,       // schedulers view vitals before/after appointments
] as const;

/** Clinical roles that can record / update vital signs */
const VITAL_WRITERS = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.SCHEDULER,       // schedulers record vitals (triage / pre-consultation)
] as const;

// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Vitals')
@ApiBearerAuth('JWT')
@ApiSecurity('WorkspaceId')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(CreateVitalDto, UpdateVitalDto, VitalResponseDto, PaginatedVitalsResponseDto)
@Controller({ path: 'vitals', version: 'v1' })
export class VitalsController {
  constructor(private readonly vitalsService: VitalsService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/vitals
   * Records a new set of vital signs for a patient.
   * Optionally links to an appointment or consultation.
   */
  @Post()
  @Roles(...VITAL_WRITERS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'vitals_create',
    summary: 'Record patient vital signs',
    description:
      'Records a new set of vital signs (temperature, blood pressure, heart rate, ' +
      'oxygen saturation, GCS, blood glucose, height, weight). ' +
      'Optionally linked to an appointment or consultation. ' +
      'workspaceId and userId are injected from the JWT.',
  })
  @ApiResponse({ status: 201, description: 'Vital signs recorded', type: VitalResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — missing required vital measurements' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async create(
    @Body() dto: CreateVitalDto,
    @Req() req: Request,
  ): Promise<VitalResponseDto> {
    return this.vitalsService.create(dto, req.userId, req.workspaceId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST / FILTER  (static sub-paths before :id param route)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/vitals
   * Paginated vital signs list with optional filters.
   */
  @Get()
  @Roles(...VITAL_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'vitals_list',
    summary: 'List vital signs with filters',
    description:
      'Returns a paginated list of vital sign records. ' +
      'Filter by patientId, appointmentId, consultationId, ' +
      'and control sort order (time or createdAt, ASC/DESC).',
  })
  @ApiResponse({ status: 200, description: 'Paginated vitals list', type: PaginatedVitalsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: VitalQueryDto,
    @Req() req: Request,
  ): Promise<PaginatedVitalsResponseDto> {
    return this.vitalsService.findAll(query, req.workspaceId);
  }

  /**
   * GET /api/v1/vitals/patient/:patientId
   * All vital sign records for a specific patient, paginated.
   */
  @Get('patient/:patientId')
  @Roles(...VITAL_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'vitals_byPatient',
    summary: 'Get vitals by patient',
    description: 'Returns paginated vital signs history for a specific patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiQuery({ name: 'page',  required: false, type: Number, example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({ status: 200, description: 'Patient vitals', type: PaginatedVitalsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedVitalsResponseDto> {
    return this.vitalsService.findByPatient(patientId, req.workspaceId, page, limit);
  }

  /**
   * GET /api/v1/vitals/appointment/:appointmentId
   * All vital sign records for a specific appointment, paginated.
   */
  @Get('appointment/:appointmentId')
  @Roles(...VITAL_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'vitals_byAppointment',
    summary: 'Get vitals by appointment',
    description: 'Returns all vital sign records linked to a specific appointment.',
  })
  @ApiParam({ name: 'appointmentId', description: 'Appointment UUID', type: String })
  @ApiQuery({ name: 'page',  required: false, type: Number, example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({ status: 200, description: 'Appointment vitals', type: PaginatedVitalsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findByAppointment(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedVitalsResponseDto> {
    return this.vitalsService.findByAppointment(appointmentId, req.workspaceId, page, limit);
  }

  /**
   * GET /api/v1/vitals/appointment/:appointmentId/latest
   * The most recently recorded vital for an appointment (used in consultation view).
   */
  @Get('appointment/:appointmentId/latest')
  @Roles(...VITAL_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'vitals_latestByAppointment',
    summary: 'Get most recent vital for appointment',
    description:
      'Returns the most recently recorded vital sign entry for an appointment. ' +
      'Useful for pre-populating the consultation view.',
  })
  @ApiParam({ name: 'appointmentId', description: 'Appointment UUID', type: String })
  @ApiResponse({ status: 200, description: 'Latest vital record', type: VitalResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'No vitals found for appointment' })
  async findLatestByAppointment(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Req() req: Request,
  ): Promise<VitalResponseDto> {
    return this.vitalsService.findFirstEntry(appointmentId, req.workspaceId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE VITAL CRUD  (must follow all static sub-path routes)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/vitals/:id
   * Retrieves a single vital sign record by UUID.
   */
  @Get(':id')
  @Roles(...VITAL_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'vitals_getById',
    summary: 'Get vital signs by ID',
    description: 'Retrieves a single vital sign record by its UUID.',
  })
  @ApiParam({ name: 'id', description: 'Vital record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Vital record', type: VitalResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Vital record not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<VitalResponseDto> {
    return this.vitalsService.findOne(id, req.workspaceId);
  }

  /**
   * PATCH /api/v1/vitals/:id
   * Partially updates a vital sign record. Prior state is captured for audit.
   */
  @Patch(':id')
  @Roles(...VITAL_WRITERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'vitals_update',
    summary: 'Update vital signs record',
    description:
      'Partially updates a vital sign record. ' +
      'Only provided fields are changed; prior state is captured for HIPAA audit.',
  })
  @ApiParam({ name: 'id', description: 'Vital record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Updated vital record', type: VitalResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Vital record not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVitalDto,
    @Req() req: Request,
  ): Promise<VitalResponseDto> {
    return this.vitalsService.update(id, dto, req.userId, req.workspaceId);
  }

  /**
   * DELETE /api/v1/vitals/:id
   * Soft-deletes a vital sign record.
   */
  @Delete(':id')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'vitals_delete',
    summary: 'Soft-delete vital record',
    description:
      'Soft-deletes a vital sign record. Data is retained for audit. ' +
      'Restricted to doctors and admins.',
  })
  @ApiParam({ name: 'id', description: 'Vital record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Vital record deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Vital record not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.vitalsService.remove(id, req.userId, req.workspaceId);
    return { message: 'Vital record deleted successfully' };
  }
}
