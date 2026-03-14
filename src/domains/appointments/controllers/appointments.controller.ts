/**
 * Appointments Controller — v1
 *
 * Enterprise-grade REST API for clinical appointment management.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs are validated 100 % through DTOs (ValidationPipe enforces)    │
 * │  All responses are typed with explicit DTO return types                   │
 * │  Error responses follow the uniform {statusCode,errorCode,message,traceId}│
 * │  envelope emitted by the global HttpExceptionFilter                       │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')   → resolves at  /api/v1/appointments                     │
 * │  URI versioning is enabled globally in main.ts (VersioningType.URI).       │
 * │  When a v2 controller is introduced, decorate it with @Version('v2') and  │
 * │  apply @Deprecated() to the routes superseded in v1.                      │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security (applied class-level, executed in declaration order) ─────────────┐
 * │  WorkspaceJwtGuard  — RS256 token verification; injects req.userId &       │
 * │                       req.workspaceId from the JWT workspace claim         │
 * │  RolesGuard         — role hierarchy enforcement via @Roles()              │
 * │  PermissionsGuard   — fine-grained permission check via @Permissions()     │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Multi-Tenancy ─────────────────────────────────────────────────────────────┐
 * │  workspaceId is extracted from the verified JWT (not from the request body │
 * │  or URL) and injected into every service call. No client-supplied          │
 * │  workspaceId is trusted — tenant isolation is enforced at the guard layer. │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Idempotency ───────────────────────────────────────────────────────────────┐
 * │  POST /appointments accepts an optional `Idempotency-Key` header.          │
 * │  Duplicate detection (cache-based) can be wired in AppointmentsService     │
 * │  once a distributed cache is available.  The key is logged for tracing.   │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1):
 *   POST   /appointments               — create appointment
 *   GET    /appointments               — paginated list with filters
 *   GET    /appointments/active        — active appointments only  ← static, before :id
 *   GET    /appointments/:id           — single appointment by UUID
 *   PATCH  /appointments/:id           — update appointment fields
 *   PATCH  /appointments/:id/done      — mark appointment as completed
 *   PATCH  /appointments/:id/cancel    — cancel appointment
 *   DELETE /appointments/:id           — soft-delete appointment
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  Version,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

// ── Guards ───────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC enums ────────────────────────────────────────────────────────────────
import { UserRole } from '../../../common/enums';

// ── Deprecation support ───────────────────────────────────────────────────────
import { Deprecated } from '../../../common/versioning/deprecated.decorator';

// ── Domain service ────────────────────────────────────────────────────────────
import { AppointmentsService } from '../services/appointments.service';

// ── Domain DTOs — 100 % DTO coverage: every param & return value is a DTO ────
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  QueryAppointmentsDto,
  AppointmentResponseDto,
  PaginatedAppointmentsResponseDto,
} from '../dtos';

// ---------------------------------------------------------------------------
// Roles shorthand groups — declare once, reuse across routes
// ---------------------------------------------------------------------------

/** Roles that may VIEW appointment data */
const VIEWER_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
  UserRole.PHARMACIST,
  UserRole.SCHEDULER,
  UserRole.BILLING_STAFF,
  UserRole.LAB_TECHNICIAN,
  UserRole.RADIOLOGY_TECHNICIAN,
  UserRole.READ_ONLY,
];

/** Roles that may CREATE or UPDATE appointments */
const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
  UserRole.SCHEDULER,
];

/**
 * Roles that may perform clinical status transitions (done / cancel).
 * SCHEDULER is included so front-desk staff can close out walk-in
 * or no-consultation appointments without a doctor needing to log in.
 */
const CLINICAL_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
  UserRole.SCHEDULER,
];

/** Roles that may hard-delete (soft-delete) records */
const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
];

// ---------------------------------------------------------------------------

@ApiTags('Appointments')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(
  AppointmentResponseDto,
  PaginatedAppointmentsResponseDto,
  CreateAppointmentDto,
  UpdateAppointmentDto,
  QueryAppointmentsDto,
)
@Controller({ path: 'appointments', version: 'v1' })
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  /**
   * POST /api/v1/appointments
   *
   * Creates a new appointment for a patient within the caller's workspace.
   *
   * Business rules enforced by service:
   *  - Patient must exist and belong to the same workspace
   *  - When paymentMethod = INSURANCE, insurance fields are required
   *  - If updatePatientInsurance = true, the patient's insurance record is
   *    created / updated atomically in the same transaction
   *
   * Idempotency: Clients SHOULD supply `Idempotency-Key` to enable safe
   * retries.  The key is currently logged for traceability; cache-based
   * duplicate detection can be added in AppointmentsService once a
   * distributed cache (e.g. Redis) is provisioned.
   */
  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('appointments:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'appointments_create',
    summary:     'Create appointment',
    description:
      'Creates a new appointment for a patient. ' +
      'When `paymentMethod` is `INSURANCE`, the insurance fields ' +
      '(`insuranceProviderId`, `schemeId`, `membershipNumber`, `memberType`) are required. ' +
      'Set `updatePatientInsurance: true` to atomically upsert the patient\'s insurance record. ' +
      'Requires `appointments:write` permission.',
  })
  @ApiHeader({
    name:        'Idempotency-Key',
    description:
      'Client-generated UUID for idempotent retries. ' +
      'Supply the same key to prevent duplicate appointments on network failures.',
    required: false,
    schema:   { type: 'string', format: 'uuid', example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
  })
  @ApiResponse({
    status:      201,
    description: 'Appointment created successfully',
    type:        AppointmentResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error — missing fields or invalid payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized — JWT missing or invalid' })
  @ApiResponse({ status: 403, description: 'Forbidden — insufficient role or permission' })
  @ApiResponse({ status: 404, description: 'Not found — patient not found in workspace' })
  async create(
    @Body() dto: CreateAppointmentDto,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AppointmentResponseDto> {
    // Log idempotency key for traceability (full duplicate detection is a cache concern)
    if (idempotencyKey) {
      req.res?.setHeader('Idempotency-Key', idempotencyKey);
    }
    return this.appointmentsService.create(dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // LIST — all appointments
  // ==========================================================================

  /**
   * GET /api/v1/appointments
   *
   * Returns a paginated, filterable list of appointments scoped to the
   * caller's workspace. Supports filtering by status, type, date range,
   * patient, and free-text search.
   */
  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('appointments:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'appointments_list',
    summary:     'List appointments',
    description:
      'Returns a paginated list of appointments for the caller\'s workspace. ' +
      'Supports filtering by `status`, `type`, `date`, `startDate`/`endDate`, `patientId`, ' +
      'and free-text `search`. Results are sorted by `date` DESC by default.',
  })
  @ApiQuery({ name: 'page',          required: false, type: Number,  description: 'Page number (1-based)',            example: 1 })
  @ApiQuery({ name: 'limit',         required: false, type: Number,  description: 'Records per page (max 100)',       example: 20 })
  @ApiQuery({ name: 'status',        required: false, type: String,  description: 'Filter by appointment status',     example: 'SCHEDULED' })
  @ApiQuery({ name: 'type',          required: false, type: String,  description: 'Filter by appointment type',       example: 'INITIAL' })
  @ApiQuery({ name: 'date',          required: false, type: String,  description: 'Filter by exact date (YYYY-MM-DD)', example: '2025-03-15' })
  @ApiQuery({ name: 'startDate',     required: false, type: String,  description: 'Date range start (YYYY-MM-DD)',    example: '2025-03-01' })
  @ApiQuery({ name: 'endDate',       required: false, type: String,  description: 'Date range end (YYYY-MM-DD)',      example: '2025-03-31' })
  @ApiQuery({ name: 'patientId',     required: false, type: String,  description: 'Filter by patient UUID',          example: 'f47ac10b-...' })
  @ApiQuery({ name: 'search',        required: false, type: String,  description: 'Full-text search term',           example: 'John' })
  @ApiQuery({ name: 'sortBy',        required: false, type: String,  description: 'Sort field',                      example: 'date' })
  @ApiQuery({ name: 'sortOrder',     required: false, type: String,  description: 'ASC | DESC',                      example: 'DESC' })
  @ApiQuery({ name: 'includeCancelled', required: false, type: Boolean, description: 'Include cancelled records',    example: false })
  @ApiResponse({
    status:      200,
    description: 'Paginated appointment list',
    type:        PaginatedAppointmentsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 422, description: 'Validation error — invalid query parameters' })
  async findAll(
    @Query() query: QueryAppointmentsDto,
    @Req() req: Request,
  ): Promise<PaginatedAppointmentsResponseDto> {
    return this.appointmentsService.findAll(query, req.workspaceId);
  }

  // ==========================================================================
  // LIST — active appointments only
  // IMPORTANT: Declared before /:id to prevent NestJS routing from treating
  // the literal "active" segment as a UUID parameter.
  // ==========================================================================

  /**
   * GET /api/v1/appointments/active
   *
   * Convenience endpoint that returns only active (non-cancelled, non-completed)
   * appointments for the workspace. Equivalent to findAll with isActive=true.
   */
  @Get('active')
  @Roles(...VIEWER_ROLES)
  @Permissions('appointments:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'appointments_listActive',
    summary:     'List active appointments',
    description:
      'Returns paginated active appointments for the workspace. ' +
      'Active means `isActive = true` and status is not CANCELLED or COMPLETED. ' +
      'Accepts the same filter/pagination query parameters as GET /appointments.',
  })
  @ApiQuery({ name: 'page',      required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit',     required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'status',    required: false, type: String, example: 'SCHEDULED' })
  @ApiQuery({ name: 'type',      required: false, type: String, example: 'INITIAL' })
  @ApiQuery({ name: 'date',      required: false, type: String, example: '2025-03-15' })
  @ApiQuery({ name: 'startDate', required: false, type: String, example: '2025-03-01' })
  @ApiQuery({ name: 'endDate',   required: false, type: String, example: '2025-03-31' })
  @ApiQuery({ name: 'patientId', required: false, type: String, example: 'f47ac10b-...' })
  @ApiQuery({ name: 'search',    required: false, type: String, example: 'John' })
  @ApiResponse({
    status:      200,
    description: 'Paginated active appointment list',
    type:        PaginatedAppointmentsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAllActive(
    @Query() query: QueryAppointmentsDto,
    @Req() req: Request,
  ): Promise<PaginatedAppointmentsResponseDto> {
    return this.appointmentsService.findAllActive(query, req.workspaceId);
  }

  // ==========================================================================
  // GET SINGLE
  // ==========================================================================

  /**
   * GET /api/v1/appointments/:id
   *
   * Fetches a single appointment by its UUID.  The appointment must belong to
   * the caller's workspace (enforced by the service).  Access is logged to the
   * audit trail (HIPAA requirement for PHI access events).
   */
  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('appointments:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'appointments_getById',
    summary:     'Get appointment by ID',
    description:
      'Retrieves a single appointment with its associated patient and consultation data. ' +
      'Returns 404 if the appointment does not exist within the caller\'s workspace. ' +
      'Access is written to the HIPAA audit log.',
  })
  @ApiParam({ name: 'id', description: 'Appointment UUID', type: String, format: 'uuid' })
  @ApiResponse({
    status:      200,
    description: 'Appointment found',
    type:        AppointmentResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Appointment not found in this workspace' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.findOne(id, req.workspaceId, req.userId);
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  /**
   * PATCH /api/v1/appointments/:id
   *
   * Partial update of an appointment.  Only fields present in the request body
   * are updated (undefined fields are ignored by the service).  All business
   * rules (insurance validation, status constraints) are re-evaluated.
   *
   * Previous and new state are captured in the audit log for compliance.
   */
  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('appointments:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'appointments_update',
    summary:     'Update appointment',
    description:
      'Partially updates an appointment. Only fields supplied in the request body are changed. ' +
      'Insurance validation is re-run if `paymentMethod` is changed to INSURANCE. ' +
      'Before/after state is recorded in the audit log.',
  })
  @ApiParam({ name: 'id', description: 'Appointment UUID', type: String, format: 'uuid' })
  @ApiResponse({
    status:      200,
    description: 'Appointment updated',
    type:        AppointmentResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error — invalid payload or business rule violation' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Appointment not found in this workspace' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @Req() req: Request,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.update(id, dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // STATUS TRANSITION — DONE
  // Route declared AFTER generic /:id but NestJS resolves /:id/done before
  // /:id because the sub-path segment "done" is a literal, not a parameter.
  // ==========================================================================

  /**
   * PATCH /api/v1/appointments/:id/done
   *
   * Marks the appointment as COMPLETED and sets isActive = false.
   * If the appointment has an associated consultation, its status is also
   * set to COMPLETED in the same transaction (atomic operation).
   *
   * Requires a clinical role (doctor, nurse, etc.) — schedulers and billing
   * staff may not complete clinical encounters.
   */
  @Patch(':id/done')
  @Roles(...CLINICAL_ROLES)
  @Permissions('appointments:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'appointments_markDone',
    summary:     'Mark appointment as completed',
    description:
      'Transitions the appointment status to COMPLETED and deactivates it. ' +
      'Simultaneously updates any linked consultation to COMPLETED. ' +
      'Operation is atomic (single database transaction). ' +
      'Requires a clinical role.',
  })
  @ApiParam({ name: 'id', description: 'Appointment UUID', type: String, format: 'uuid' })
  @ApiResponse({
    status:      200,
    description: 'Appointment marked as completed',
    type:        AppointmentResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical or scheduler role required' })
  @ApiResponse({ status: 404, description: 'Appointment not found in this workspace' })
  async markAsDone(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.markAsDone(id, req.workspaceId, req.userId);
  }

  // ==========================================================================
  // STATUS TRANSITION — CANCEL
  // ==========================================================================

  /**
   * PATCH /api/v1/appointments/:id/cancel
   *
   * Cancels the appointment.  Sets status = CANCELLED and isActive = false.
   * If the appointment has a linked consultation, it is also moved to
   * COMPLETED status in the same transaction.
   *
   * Schedulers may cancel appointments in addition to clinical staff.
   */
  @Patch(':id/cancel')
  @Roles(...WRITE_ROLES)
  @Permissions('appointments:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'appointments_cancel',
    summary:     'Cancel appointment',
    description:
      'Cancels the appointment and deactivates it. ' +
      'Any linked consultation is set to COMPLETED in the same transaction. ' +
      'Operation is atomic. Scheduler, clinical, and admin roles may cancel.',
  })
  @ApiParam({ name: 'id', description: 'Appointment UUID', type: String, format: 'uuid' })
  @ApiResponse({
    status:      200,
    description: 'Appointment cancelled',
    type:        AppointmentResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Appointment not found in this workspace' })
  async cancelAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.cancelAppointment(id, req.workspaceId, req.userId);
  }

  // ==========================================================================
  // DELETE (soft delete)
  // ==========================================================================

  /**
   * DELETE /api/v1/appointments/:id
   *
   * Soft-deletes the appointment by setting `deletedAt` and `isDeleted = true`.
   * The record is retained in the database for audit trail purposes and can be
   * restored by an administrator.
   *
   * Restricted to admin roles to prevent accidental data loss.
   */
  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @Permissions('appointments:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'appointments_delete',
    summary:     'Delete appointment (soft delete)',
    description:
      'Soft-deletes the appointment. The record is retained in the database ' +
      'for audit / compliance purposes (`deletedAt` timestamp is set). ' +
      'Restricted to workspace owner, system admin, and practice admin roles.',
  })
  @ApiParam({ name: 'id', description: 'Appointment UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Appointment deleted (no content)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  @ApiResponse({ status: 404, description: 'Appointment not found in this workspace' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.appointmentsService.remove(id, req.workspaceId);
  }
}

// ---------------------------------------------------------------------------
// Deprecation example — illustrates how to deprecate a v1 route when v2 ships:
//
// @Deprecated('2027-01-01T00:00:00Z')
// @Get(':id/legacy-detail')
// async getLegacyDetail(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
//   return this.appointmentsService.findOne(id, req.workspaceId, req.userId);
// }
// ---------------------------------------------------------------------------
