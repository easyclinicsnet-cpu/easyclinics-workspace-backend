/**
 * Allergies Controller — v1
 *
 * Enterprise-grade REST API for patient allergy and intolerance management.
 *
 * ┌─ Contract ──────────────────────────────────────────────────────────────┐
 * │  100% DTO-validated inputs and typed responses                          │
 * │  Duplicate allergen detection enforced at service layer                 │
 * │  workspaceId & userId always injected from the verified JWT             │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌─ Versioning ────────────────────────────────────────────────────────────┐
 * │  Global prefix 'api/v1' (set in main.ts) → resolves at /api/v1/allergies│
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌─ Security (applied in order) ───────────────────────────────────────────┐
 * │  WorkspaceJwtGuard — validates RS256 JWT, attaches req.user             │
 * │  RolesGuard        — role hierarchy enforcement                         │
 * │  PermissionsGuard  — fine-grained permission check                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Route map:
 *   POST   /api/v1/allergies                          — record allergy
 *   GET    /api/v1/allergies                          — list with filters
 *   GET    /api/v1/allergies/patient/:patientId       — allergies by patient
 *   GET    /api/v1/allergies/severity/:severity       — filter by severity level
 *   GET    /api/v1/allergies/:id                      — single allergy
 *   PATCH  /api/v1/allergies/:id                      — update allergy
 *   DELETE /api/v1/allergies/:id                      — soft delete
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
import { UserRole, Severity } from '../../../common/enums';

// Services
import { AllergiesService } from '../services/allergies.service';

// DTOs
import {
  CreateAllergyDto,
  UpdateAllergyDto,
  AllergyResponseDto,
  AllergyQueryDto,
  PaginatedAllergiesResponseDto,
} from '../dto/allergy';

// ─────────────────────────────────────────────────────────────────────────────

/** Clinical roles that can read allergy records */
const ALLERGY_READERS = [
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

/** Clinical roles that can create / update allergy records */
const ALLERGY_WRITERS = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
] as const;

// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Allergies')
@ApiBearerAuth('JWT')
@ApiSecurity('WorkspaceId')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(
  CreateAllergyDto,
  UpdateAllergyDto,
  AllergyResponseDto,
  PaginatedAllergiesResponseDto,
)
@Controller({ path: 'allergies', version: 'v1' })
export class AllergiesController {
  constructor(private readonly allergiesService: AllergiesService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/allergies
   * Records a new allergy for a patient. Duplicate allergen detection is enforced.
   */
  @Post()
  @Roles(...ALLERGY_WRITERS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'allergies_create',
    summary: 'Record patient allergy',
    description:
      'Records a new allergy or intolerance for a patient. ' +
      'Duplicate allergen detection is enforced — a ConflictException is thrown ' +
      'if the same substance is already recorded for the patient. ' +
      'workspaceId and userId are injected from the JWT.',
  })
  @ApiResponse({ status: 201, description: 'Allergy recorded', type: AllergyResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — missing required fields' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  @ApiResponse({ status: 409, description: 'Conflict — duplicate allergen already recorded' })
  async create(
    @Body() dto: CreateAllergyDto,
    @Req() req: Request,
  ): Promise<AllergyResponseDto> {
    return this.allergiesService.create(dto, req.userId, req.workspaceId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST / FILTER  (static sub-paths before :id param route)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/allergies
   * Paginated allergy list with optional filters.
   */
  @Get()
  @Roles(...ALLERGY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'allergies_list',
    summary: 'List allergy records with filters',
    description:
      'Returns a paginated list of allergy records in the workspace. ' +
      'Optionally filter by patientId, substance substring, or severity level.',
  })
  @ApiResponse({ status: 200, description: 'Paginated allergy list', type: PaginatedAllergiesResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: AllergyQueryDto,
    @Req() req: Request,
  ): Promise<PaginatedAllergiesResponseDto> {
    return this.allergiesService.findAll(query, req.workspaceId);
  }

  /**
   * GET /api/v1/allergies/patient/:patientId
   * All allergies for a specific patient, paginated.
   */
  @Get('patient/:patientId')
  @Roles(...ALLERGY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'allergies_byPatient',
    summary: 'Get allergies by patient',
    description: 'Returns all active allergy records for a specific patient, paginated.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiQuery({ name: 'page',  required: false, type: Number, example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({ status: 200, description: 'Patient allergies', type: PaginatedAllergiesResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedAllergiesResponseDto> {
    return this.allergiesService.findByPatient(patientId, req.workspaceId, page, limit);
  }

  /**
   * GET /api/v1/allergies/severity/:severity
   * All workspace allergies filtered by severity level, paginated.
   */
  @Get('severity/:severity')
  @Roles(...ALLERGY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'allergies_bySeverity',
    summary: 'Filter allergies by severity',
    description:
      'Returns all allergy records in the workspace matching a specific severity level. ' +
      'Useful for identifying patients with life-threatening or severe allergies.',
  })
  @ApiParam({
    name: 'severity',
    description: 'Allergy severity level',
    enum: Severity,
    example: Severity.SEVERE,
  })
  @ApiQuery({ name: 'page',  required: false, type: Number, example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: 'Allergies matching severity', type: PaginatedAllergiesResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findBySeverity(
    @Param('severity') severity: Severity,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedAllergiesResponseDto> {
    return this.allergiesService.findBySeverity(severity, req.workspaceId, page, limit);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE ALLERGY CRUD  (must follow all static sub-path routes)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/allergies/:id
   * Retrieves a single allergy record by UUID.
   */
  @Get(':id')
  @Roles(...ALLERGY_READERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'allergies_getById',
    summary: 'Get allergy by ID',
    description: 'Retrieves a single allergy record by its UUID.',
  })
  @ApiParam({ name: 'id', description: 'Allergy record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Allergy record', type: AllergyResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Allergy not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<AllergyResponseDto> {
    return this.allergiesService.findOne(id, req.workspaceId);
  }

  /**
   * PATCH /api/v1/allergies/:id
   * Partially updates an allergy record. Duplicate substance re-check is performed.
   */
  @Patch(':id')
  @Roles(...ALLERGY_WRITERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'allergies_update',
    summary: 'Update allergy record',
    description:
      'Partially updates an allergy record. ' +
      'Duplicate substance detection is re-evaluated on update. ' +
      'Only provided fields are changed.',
  })
  @ApiParam({ name: 'id', description: 'Allergy record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Updated allergy record', type: AllergyResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Allergy not found' })
  @ApiResponse({ status: 409, description: 'Conflict — duplicate allergen' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAllergyDto,
    @Req() req: Request,
  ): Promise<AllergyResponseDto> {
    return this.allergiesService.update(id, dto, req.userId, req.workspaceId);
  }

  /**
   * DELETE /api/v1/allergies/:id
   * Soft-deletes an allergy record.
   */
  @Delete(':id')
  @Roles(
    UserRole.WORKSPACE_OWNER,
    UserRole.ADMIN,
    UserRole.PRACTICE_ADMIN,
    UserRole.DOCTOR,
    UserRole.NURSE,
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'allergies_delete',
    summary: 'Soft-delete allergy record',
    description:
      'Soft-deletes an allergy record. Data is retained for HIPAA audit compliance.',
  })
  @ApiParam({ name: 'id', description: 'Allergy record UUID', type: String })
  @ApiResponse({ status: 200, description: 'Allergy deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Allergy not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.allergiesService.remove(id, req.userId, req.workspaceId);
    return { message: 'Allergy record deleted successfully' };
  }
}
