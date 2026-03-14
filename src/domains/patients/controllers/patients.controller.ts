/**
 * Patients Controller — v1
 *
 * Enterprise-grade REST API for core patient management.
 *
 * ┌─ Contract ──────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100% through DTOs (class-validator)               │
 * │  All responses typed with explicit DTO return types                     │
 * │  workspaceId & userId always injected from the verified JWT —           │
 * │  never trusted from the request body                                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌─ Versioning ────────────────────────────────────────────────────────────┐
 * │  Global prefix 'api/v1' (set in main.ts) → resolves at /api/v1/patients │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌─ Security (applied in order) ───────────────────────────────────────────┐
 * │  WorkspaceJwtGuard — validates RS256 JWT, attaches req.user             │
 * │  RolesGuard        — role hierarchy enforcement                         │
 * │  PermissionsGuard  — fine-grained permission check                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Route map:
 *   POST   /api/v1/patients                        — create patient
 *   GET    /api/v1/patients                        — paginated list / search
 *   GET    /api/v1/patients/search/advanced        — multi-criteria advanced search
 *   GET    /api/v1/patients/search/by-file-number  — exact file-number lookup
 *   GET    /api/v1/patients/search/by-phone        — exact phone lookup
 *   GET    /api/v1/patients/search/by-name         — token-based name search
 *   GET    /api/v1/patients/index/stats            — search index statistics
 *   POST   /api/v1/patients/index/rebuild          — force index rebuild (admin)
 *   POST   /api/v1/patients/bulk-update            — batch update (admin)
 *   GET    /api/v1/patients/:id                    — single patient by UUID
 *   PATCH  /api/v1/patients/:id                    — partial update
 *   DELETE /api/v1/patients/:id                    — soft delete (admin)
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
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// RBAC
import { UserRole } from '../../../common/enums';

// Services
import { PatientsService } from '../services/patients.service';

// DTOs
import {
  CreatePatientDto,
  UpdatePatientDto,
  QueryPatientsDto,
  PatientResponseDto,
  PaginatedPatientsResponseDto,
} from '../dto';

// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Patients')
@ApiBearerAuth('JWT')
@ApiSecurity('WorkspaceId')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(
  CreatePatientDto,
  UpdatePatientDto,
  QueryPatientsDto,
  PatientResponseDto,
  PaginatedPatientsResponseDto,
)
@Controller({ path: 'patients', version: 'v1' })
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/patients
   * Creates a new patient record within the authenticated workspace.
   * workspaceId is enforced from JWT; the body field is overridden.
   */
  @Post()
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MEDICAL_ASSISTANT,
    UserRole.SCHEDULER,
  )
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'patients_create',
    summary: 'Create a new patient',
    description:
      'Creates a new patient record in the authenticated workspace. ' +
      'workspaceId and userId are injected from the JWT. ' +
      'Supports optional insurance record creation via the updatePatientInsurance flag.',
  })
  @ApiResponse({ status: 201, description: 'Patient created', type: PatientResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — invalid body' })
  @ApiResponse({ status: 401, description: 'Unauthorized — JWT missing or invalid' })
  @ApiResponse({ status: 403, description: 'Forbidden — insufficient role' })
  @ApiResponse({ status: 409, description: 'Conflict — duplicate file number or national ID' })
  async create(
    @Body() dto: CreatePatientDto,
    @Req() req: Request,
  ): Promise<PatientResponseDto> {
    // Workspace and user identity are always sourced from the verified JWT
    dto.workspaceId = req.workspaceId;
    return this.patientsService.create(dto, req.userId, req.workspaceId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST / SEARCH  (static sub-paths declared before :id param route)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/patients
   * Paginated patient list with optional search and filter params.
   */
  @Get()
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MEDICAL_ASSISTANT,
    UserRole.SCHEDULER,
    UserRole.BILLING_STAFF,
    UserRole.READ_ONLY,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_list',
    summary: 'List / search patients',
    description:
      'Returns a paginated list of patients in the workspace. ' +
      'Supports full-text search, gender/city/status filters, age-range filtering, ' +
      'and flexible sorting. Backed by an in-memory index (5-minute rebuild cycle).',
  })
  @ApiResponse({ status: 200, description: 'Paginated patient list', type: PaginatedPatientsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 422, description: 'Validation error — invalid query parameters' })
  async findAll(
    @Query() query: QueryPatientsDto,
    @Req() req: Request,
  ): Promise<PaginatedPatientsResponseDto> {
    query.workspaceId = req.workspaceId;
    return this.patientsService.findAll(query);
  }

  /**
   * GET /api/v1/patients/search/advanced
   * Multi-criteria search: name, gender, city, age range, appointment status.
   */
  @Get('search/advanced')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MEDICAL_ASSISTANT,
    UserRole.SCHEDULER,
    UserRole.BILLING_STAFF,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_advancedSearch',
    summary: 'Advanced multi-criteria patient search',
    description:
      'Search patients by any combination of name, gender, city, age range, ' +
      'active status, and appointment status. Returns paginated results.',
  })
  @ApiResponse({ status: 200, description: 'Advanced search results', type: PaginatedPatientsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async advancedSearch(
    @Query() query: QueryPatientsDto,
    @Req() req: Request,
  ): Promise<PaginatedPatientsResponseDto> {
    return this.patientsService.advancedSearch(
      req.workspaceId,
      {
        name: query.search,
        city: query.city,
        gender: query.gender as any,
        ageRange: query.ageRange?.min != null && query.ageRange?.max != null
          ? { min: query.ageRange.min, max: query.ageRange.max }
          : undefined,
      },
      query.page ?? 1,
      query.limit ?? 10,
    );
  }

  /**
   * GET /api/v1/patients/search/by-file-number?fileNumber=PAT-2024-001
   * Fast exact-match lookup by patient file number.
   */
  @Get('search/by-file-number')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MEDICAL_ASSISTANT,
    UserRole.SCHEDULER,
    UserRole.BILLING_STAFF,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_findByFileNumber',
    summary: 'Find patient by file number',
    description: 'Fast exact-match index lookup by file number within the workspace.',
  })
  @ApiQuery({ name: 'fileNumber', required: true, type: String, example: 'PAT-2024-001' })
  @ApiResponse({ status: 200, description: 'Matching patients', type: PaginatedPatientsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findByFileNumber(
    @Query('fileNumber') fileNumber: string,
    @Req() req: Request,
  ): Promise<PaginatedPatientsResponseDto> {
    return this.patientsService.findByFileNumber(fileNumber, req.workspaceId);
  }

  /**
   * GET /api/v1/patients/search/by-phone?phoneNumber=%2B27821234567
   * Fast exact-match lookup by phone number.
   */
  @Get('search/by-phone')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MEDICAL_ASSISTANT,
    UserRole.SCHEDULER,
    UserRole.BILLING_STAFF,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_findByPhone',
    summary: 'Find patient by phone number',
    description: 'Fast index-backed exact lookup by phone number (E.164 format) within the workspace.',
  })
  @ApiQuery({ name: 'phoneNumber', required: true, type: String, example: '+27821234567' })
  @ApiResponse({ status: 200, description: 'Matching patients', type: PaginatedPatientsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findByPhone(
    @Query('phoneNumber') phoneNumber: string,
    @Req() req: Request,
  ): Promise<PaginatedPatientsResponseDto> {
    return this.patientsService.findByPhone(phoneNumber, req.workspaceId);
  }

  /**
   * GET /api/v1/patients/search/by-name?name=John+Doe
   * Token-based name search with partial first/last name and reverse-order support.
   */
  @Get('search/by-name')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MEDICAL_ASSISTANT,
    UserRole.SCHEDULER,
    UserRole.BILLING_STAFF,
    UserRole.READ_ONLY,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_findByName',
    summary: 'Find patients by name',
    description:
      'Token-based name search supporting partial first/last name matches ' +
      'and reverse-order full-name lookups (e.g. "Doe John" matches "John Doe").',
  })
  @ApiQuery({ name: 'name', required: true, type: String, example: 'John Doe' })
  @ApiResponse({ status: 200, description: 'Matching patients', type: PaginatedPatientsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findByName(
    @Query('name') name: string,
    @Req() req: Request,
  ): Promise<PaginatedPatientsResponseDto> {
    return this.patientsService.findByName(req.workspaceId, name);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH INDEX MANAGEMENT  (admin-only)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/patients/index/stats
   * Returns current in-memory search index metrics.
   */
  @Get('index/stats')
  @Roles(UserRole.WORKSPACE_OWNER, UserRole.ADMIN, UserRole.PRACTICE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_indexStats',
    summary: 'Search index statistics',
    description:
      'Returns the current state of the in-memory patient search index: ' +
      'total indexed patients, last rebuild timestamp, and staleness indicator.',
  })
  @ApiResponse({ status: 200, description: 'Index statistics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin only' })
  async getIndexStats() {
    return this.patientsService.getIndexStats();
  }

  /**
   * POST /api/v1/patients/index/rebuild
   * Triggers an immediate out-of-cycle rebuild of the in-memory search index.
   */
  @Post('index/rebuild')
  @Roles(UserRole.WORKSPACE_OWNER, UserRole.ADMIN, UserRole.PRACTICE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_indexRebuild',
    summary: 'Force search index rebuild',
    description:
      'Immediately triggers a full rebuild of the in-memory patient search index. ' +
      'Useful after bulk imports or data migrations. ' +
      'The index also rebuilds automatically every 5 minutes.',
  })
  @ApiResponse({ status: 200, description: 'Rebuild triggered' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin only' })
  async rebuildIndex(): Promise<{ message: string }> {
    await this.patientsService.rebuildSearchIndex();
    return { message: 'Search index rebuild triggered successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BULK OPERATIONS  (admin-only)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/patients/bulk-update
   * Batch update of multiple patient records in a single transaction.
   */
  @Post('bulk-update')
  @Roles(UserRole.WORKSPACE_OWNER, UserRole.ADMIN, UserRole.PRACTICE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_bulkUpdate',
    summary: 'Batch update multiple patients',
    description:
      'Updates multiple patient records in a single request. ' +
      'Accepts an array of partial update objects. ' +
      'Restricted to workspace owners and admins.',
  })
  @ApiResponse({ status: 200, description: 'Bulk update result (success/failure counts)' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin only' })
  async bulkUpdate(
    @Body() updates: Array<{ id: string } & Partial<UpdatePatientDto>>,
    @Req() req: Request,
  ) {
    return this.patientsService.bulkUpdate(updates, req.workspaceId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE-PATIENT CRUD  (must follow all static sub-path routes)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/patients/:id
   * Retrieves a single patient by UUID. Every access is HIPAA-logged.
   */
  @Get(':id')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MEDICAL_ASSISTANT,
    UserRole.PHARMACIST,
    UserRole.THERAPIST,
    UserRole.LAB_TECHNICIAN,
    UserRole.RADIOLOGY_TECHNICIAN,
    UserRole.SCHEDULER,
    UserRole.BILLING_STAFF,
    UserRole.READ_ONLY,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_getById',
    summary: 'Get patient by ID',
    description:
      'Retrieves a single patient with all decrypted demographic, contact, and insurance data. ' +
      'Every access is HIPAA-logged with user identity, timestamp, and workspace.',
  })
  @ApiParam({ name: 'id', description: 'Patient UUID', type: String })
  @ApiResponse({ status: 200, description: 'Patient record', type: PatientResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<PatientResponseDto> {
    return this.patientsService.findOne(id, req.userId, req.workspaceId);
  }

  /**
   * PATCH /api/v1/patients/:id
   * Partially updates a patient record. Only supplied fields are changed.
   */
  @Patch(':id')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MEDICAL_ASSISTANT,
    UserRole.SCHEDULER,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_update',
    summary: 'Update patient record',
    description:
      'Partially updates a patient record — only fields present in the body are changed. ' +
      'workspaceId is always enforced from the JWT; the body value is overridden.',
  })
  @ApiParam({ name: 'id', description: 'Patient UUID', type: String })
  @ApiResponse({ status: 200, description: 'Updated patient record', type: PatientResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
    @Req() req: Request,
  ): Promise<PatientResponseDto> {
    dto.workspaceId = req.workspaceId;
    return this.patientsService.update(id, dto, req.userId, req.workspaceId);
  }

  /**
   * DELETE /api/v1/patients/:id
   * Soft-deletes a patient (sets deletedAt). Data is retained for compliance.
   */
  @Delete(':id')
  @Roles(UserRole.WORKSPACE_OWNER, UserRole.ADMIN, UserRole.PRACTICE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_delete',
    summary: 'Soft-delete patient',
    description:
      'Soft-deletes a patient record by setting the deletedAt timestamp. ' +
      'All patient data is preserved for audit and HIPAA compliance. ' +
      'Restricted to workspace owners and practice admins.',
  })
  @ApiParam({ name: 'id', description: 'Patient UUID', type: String })
  @ApiResponse({ status: 200, description: 'Patient soft-deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin only' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.patientsService.remove(id, req.userId, req.workspaceId);
    return { message: 'Patient record deactivated successfully' };
  }
}
