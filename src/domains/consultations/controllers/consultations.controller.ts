/**
 * Consultations Controller — v1
 *
 * Core CRUD layer for medical consultation sessions.
 * Covers the full consultation lifecycle from creation through completion,
 * including paginated listing, patient/doctor scoped queries, and joining-
 * settings management.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100 % through DTOs (ValidationPipe enforces)        │
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/consultations                     │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1):
 *   POST   /consultations                          — create a consultation
 *   GET    /consultations                          — paginated list
 *   GET    /consultations/patient/:patientId       — by patient (paginated)
 *   GET    /consultations/doctor/:doctorId         — by doctor (paginated)
 *   GET    /consultations/:id                      — single consultation
 *   PATCH  /consultations/:id                      — update consultation
 *   PATCH  /consultations/:id/joining-settings     — update joining settings
 *   DELETE /consultations/:id                      — soft-delete consultation
 */

import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiExtraModels,
} from '@nestjs/swagger';
import { Request } from 'express';

// ── Guards ────────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC enums ────────────────────────────────────────────────────────────────
import { UserRole } from '../../../common/enums';

// ── Domain service ────────────────────────────────────────────────────────────
import { ConsultationsService } from '../services/consultations.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateConsultationDto,
  UpdateConsultationDto,
  ConsultationResponseDto,
  ConsultationQueryDto,
  UpdateJoiningSettingsDto,
  PaginatedResponseDto,
} from '../dto';

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

const VIEWER_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
  UserRole.PHARMACIST,
  UserRole.BILLING_STAFF,
  UserRole.SCHEDULER,
];

const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
];

const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
];

// ---------------------------------------------------------------------------

@ApiTags('Consultations')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(ConsultationResponseDto, CreateConsultationDto)
@Controller({ path: 'consultations', version: 'v1' })
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  /**
   * POST /api/v1/consultations
   */
  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'consultations_create',
    summary:     'Create a new consultation',
    description:
      'Opens a new medical consultation session. ' +
      'The requesting user is automatically set as the initiating doctor and ' +
      'granted OWNER-level collaboration access.',
  })
  @ApiResponse({ status: 201, description: 'Consultation created',    type: ConsultationResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  async create(
    @Body() dto: CreateConsultationDto,
    @Req() req: Request,
  ): Promise<ConsultationResponseDto> {
    return this.consultationsService.create(dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // READ — static / prefix-parameterised paths before /:id
  // ==========================================================================

  /**
   * GET /api/v1/consultations
   */
  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('consultations:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consultations_findAll',
    summary:     'List consultations (paginated)',
    description: 'Returns a paginated, filterable list of consultations for the workspace.',
  })
  @ApiResponse({ status: 200, description: 'Paginated consultation list', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: ConsultationQueryDto,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<ConsultationResponseDto>> {
    return this.consultationsService.findAll(query, req.workspaceId);
  }

  /**
   * GET /api/v1/consultations/patient/:patientId?page=1&limit=10
   */
  @Get('patient/:patientId')
  @Roles(...VIEWER_ROLES)
  @Permissions('consultations:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consultations_byPatient',
    summary:     'Get consultations by patient',
    description: 'Returns a paginated list of all consultations linked to the specified patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Patient consultations', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<ConsultationResponseDto>> {
    return this.consultationsService.findByPatient(patientId, req.workspaceId, page, limit);
  }

  /**
   * GET /api/v1/consultations/doctor/:doctorId?page=1&limit=10
   */
  @Get('doctor/:doctorId')
  @Roles(...VIEWER_ROLES)
  @Permissions('consultations:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consultations_byDoctor',
    summary:     'Get consultations by doctor',
    description: 'Returns a paginated list of consultations initiated or managed by the specified doctor.',
  })
  @ApiParam({ name: 'doctorId', description: 'Doctor user UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Doctor consultations', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findByDoctor(
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<ConsultationResponseDto>> {
    return this.consultationsService.findByDoctor(doctorId, req.workspaceId, page, limit);
  }

  // ==========================================================================
  // READ — parameterised /:id (declared AFTER all static/prefix paths)
  // ==========================================================================

  /**
   * GET /api/v1/consultations/:id
   */
  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('consultations:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consultations_findOne',
    summary:     'Get a consultation by ID',
    description: 'Returns the full details of a single consultation. Access is restricted to workspace members.',
  })
  @ApiParam({ name: 'id', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Consultation details',    type: ConsultationResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<ConsultationResponseDto> {
    return this.consultationsService.findOne(id, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  /**
   * PATCH /api/v1/consultations/:id
   */
  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consultations_update',
    summary:     'Update a consultation',
    description: 'Partially updates a consultation. Only the consultation owner or admins may modify it.',
  })
  @ApiParam({ name: 'id', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Consultation updated',    type: ConsultationResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin required' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConsultationDto,
    @Req() req: Request,
  ): Promise<ConsultationResponseDto> {
    return this.consultationsService.update(id, dto, req.userId, req.workspaceId);
  }

  /**
   * PATCH /api/v1/consultations/:id/joining-settings
   */
  @Patch(':id/joining-settings')
  @Roles(...WRITE_ROLES)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consultations_updateJoiningSettings',
    summary:     'Update consultation joining settings',
    description:
      'Controls whether the consultation is open for joining and whether join requests require approval. ' +
      'Only the consultation owner may change these settings.',
  })
  @ApiParam({ name: 'id', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Joining settings updated', type: ConsultationResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — consultation owner required' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  async updateJoiningSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJoiningSettingsDto,
    @Req() req: Request,
  ): Promise<ConsultationResponseDto> {
    return this.consultationsService.updateJoiningSettings(id, dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // DELETE
  // ==========================================================================

  /**
   * DELETE /api/v1/consultations/:id
   */
  @Delete(':id')
  @Roles(...ADMIN_ROLES, UserRole.DOCTOR)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'consultations_remove',
    summary:     'Delete a consultation',
    description:
      'Permanently removes a consultation and all associated records. ' +
      'Restricted to consultation owners and workspace admins.',
  })
  @ApiParam({ name: 'id', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Consultation deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin required' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.consultationsService.remove(id, req.userId, req.workspaceId);
  }
}
