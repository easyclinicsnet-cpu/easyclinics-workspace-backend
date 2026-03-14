/**
 * Insurance Providers Controller — v1
 *
 * CRUD endpoints for managing insurance provider master records.
 * Providers are global (not workspace-scoped) master data entries.
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/insurance/providers                │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (class-level)           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/insurance/providers):
 *   POST   /                 — create provider
 *   GET    /                 — list (paginated, filtered)
 *   GET    /code/:code       — find by provider code
 *   PATCH  /:id/status       — update status (activate / deactivate / suspend)
 *   PATCH  /:id              — partial update
 *   DELETE /:id              — soft-delete
 *   GET    /:id              — get by UUID (LAST)
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

// ── Guards ────────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard } from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }        from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }  from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC ─────────────────────────────────────────────────────────────────────
import { UserRole } from '../../../common/enums';

// ── Domain ────────────────────────────────────────────────────────────────────
import { InsuranceProviderService } from '../services/insurance-provider.service';
import { ProviderStatus }           from '../entities/insurance-provider.entity';
import {
  CreateInsuranceProviderDto,
  UpdateInsuranceProviderDto,
  QueryInsuranceProviderDto,
  InsuranceProviderResponseDto,
} from '../dtos';
import { IPaginatedResult } from '../interfaces';

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
  UserRole.BILLING_STAFF,
  UserRole.PHARMACIST,
  UserRole.THERAPIST,
  UserRole.SCHEDULER,
];

const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.BILLING_STAFF,
];

const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
];

// ---------------------------------------------------------------------------

@ApiTags('Insurance — Providers')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'insurance/providers', version: 'v1' })
export class InsuranceProviderController {
  constructor(private readonly providerService: InsuranceProviderService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('insurance:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'providers_create',
    summary:     'Create insurance provider',
    description: 'Creates a new global insurance provider master record.',
  })
  @ApiResponse({ status: 201, description: 'Provider created',       type: InsuranceProviderResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'Provider code already exists' })
  async create(
    @Body() dto: CreateInsuranceProviderDto,
  ): Promise<InsuranceProviderResponseDto> {
    return this.providerService.create(dto);
  }

  // ==========================================================================
  // LIST
  // ==========================================================================

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'providers_findAll',
    summary:     'List insurance providers',
    description: 'Returns a paginated list of all insurance providers.',
  })
  @ApiResponse({ status: 200, description: 'Paginated provider list', type: [InsuranceProviderResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: QueryInsuranceProviderDto,
  ): Promise<IPaginatedResult<InsuranceProviderResponseDto>> {
    return this.providerService.findAll(query);
  }

  // ==========================================================================
  // STATIC ROUTES — before /:id
  // ==========================================================================

  @Get('code/:code')
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'providers_findByCode',
    summary:     'Find provider by code',
    description: 'Looks up a single insurance provider by its unique provider code.',
  })
  @ApiParam({ name: 'code', description: 'Provider code', type: String })
  @ApiResponse({ status: 200, description: 'Provider',            type: InsuranceProviderResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async findByCode(@Param('code') code: string): Promise<InsuranceProviderResponseDto> {
    return this.providerService.findByCode(code);
  }

  // ==========================================================================
  // UPDATE STATUS — before PATCH /:id to avoid conflict
  // ==========================================================================

  @Patch(':id/status')
  @Roles(...ADMIN_ROLES)
  @Permissions('insurance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'providers_updateStatus',
    summary:     'Update provider status',
    description: 'Changes the provider status to ACTIVE, INACTIVE, or SUSPENDED.',
  })
  @ApiParam({ name: 'id', description: 'Provider UUID', type: String, format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: Object.values(ProviderStatus) } },
    },
  })
  @ApiResponse({ status: 200, description: 'Updated provider', type: InsuranceProviderResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid status value' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status')             status: ProviderStatus,
    @Req()                      req:    Request,
  ): Promise<InsuranceProviderResponseDto> {
    return this.providerService.updateStatus(id, status, req.userId);
  }

  // ==========================================================================
  // UPDATE / DELETE
  // ==========================================================================

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('insurance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'providers_update',
    summary:     'Update insurance provider',
    description: 'Applies a partial update to an existing insurance provider.',
  })
  @ApiParam({ name: 'id', description: 'Provider UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated provider', type: InsuranceProviderResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async update(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     dto: UpdateInsuranceProviderDto,
    @Req()                      req: Request,
  ): Promise<InsuranceProviderResponseDto> {
    return this.providerService.update(id, dto, req.userId);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @Permissions('insurance:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'providers_delete',
    summary:     'Soft-delete insurance provider',
    description: 'Soft-deletes an insurance provider. The record is retained for audit purposes.',
  })
  @ApiParam({ name: 'id', description: 'Provider UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Provider deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<void> {
    return this.providerService.softDelete(id, req.userId);
  }

  // ==========================================================================
  // GET BY ID — LAST
  // ==========================================================================

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'providers_findById',
    summary:     'Get insurance provider by ID',
    description: 'Returns a single insurance provider by its UUID.',
  })
  @ApiParam({ name: 'id', description: 'Provider UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Provider',            type: InsuranceProviderResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InsuranceProviderResponseDto> {
    return this.providerService.findById(id);
  }
}
