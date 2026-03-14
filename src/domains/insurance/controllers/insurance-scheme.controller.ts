/**
 * Insurance Schemes Controller — v1
 *
 * CRUD endpoints for managing insurance scheme (plan) master records.
 * Schemes are global (not workspace-scoped) and linked to providers.
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/insurance/schemes                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/insurance/schemes):
 *   POST   /                        — create scheme
 *   GET    /                        — list (paginated, filtered)
 *   GET    /provider/:providerId    — all active schemes for a provider
 *   GET    /code/:code              — find by scheme code
 *   PATCH  /:id                     — partial update
 *   DELETE /:id                     — soft-delete
 *   GET    /:id                     — get by UUID (LAST)
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
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

import { WorkspaceJwtGuard } from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }        from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }  from '../../../common/security/auth/permissions.guard';
import { Roles, Permissions } from '../../../common/security/auth/decorators';
import { UserRole } from '../../../common/enums';

import { InsuranceSchemeService } from '../services/insurance-scheme.service';
import {
  CreateInsuranceSchemeDto,
  UpdateInsuranceSchemeDto,
  QueryInsuranceSchemeDto,
  InsuranceSchemeResponseDto,
} from '../dtos';
import { IPaginatedResult } from '../interfaces';

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

@ApiTags('Insurance — Schemes')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'insurance/schemes', version: 'v1' })
export class InsuranceSchemeController {
  constructor(private readonly schemeService: InsuranceSchemeService) {}

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('insurance:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'schemes_create',
    summary:     'Create insurance scheme',
    description: 'Creates a new insurance scheme linked to an existing provider.',
  })
  @ApiResponse({ status: 201, description: 'Scheme created',       type: InsuranceSchemeResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Insurance provider not found' })
  @ApiResponse({ status: 409, description: 'Scheme code already exists' })
  async create(@Body() dto: CreateInsuranceSchemeDto): Promise<InsuranceSchemeResponseDto> {
    return this.schemeService.create(dto);
  }

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'schemes_findAll',
    summary:     'List insurance schemes',
    description: 'Returns a paginated list of insurance schemes. Use providerId query param to filter by provider.',
  })
  @ApiResponse({ status: 200, description: 'Paginated scheme list', type: [InsuranceSchemeResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(@Query() query: QueryInsuranceSchemeDto): Promise<IPaginatedResult<InsuranceSchemeResponseDto>> {
    return this.schemeService.findAll(query);
  }

  // ── Static routes ─────────────────────────────────────────────────────────

  @Get('provider/:providerId')
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'schemes_byProvider',
    summary:     'Get schemes by provider',
    description: 'Returns all active schemes for a specific insurance provider (un-paginated, suitable for dropdowns).',
  })
  @ApiParam({ name: 'providerId', description: 'Insurance provider UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Schemes for provider', type: [InsuranceSchemeResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findByProvider(
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ): Promise<InsuranceSchemeResponseDto[]> {
    return this.schemeService.findByProvider(providerId);
  }

  @Get('code/:code')
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'schemes_findByCode',
    summary:     'Find scheme by code',
    description: 'Looks up a single insurance scheme by its unique scheme code.',
  })
  @ApiParam({ name: 'code', description: 'Scheme code', type: String })
  @ApiResponse({ status: 200, description: 'Scheme',              type: InsuranceSchemeResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Scheme not found' })
  async findByCode(@Param('code') code: string): Promise<InsuranceSchemeResponseDto> {
    return this.schemeService.findByCode(code);
  }

  // ── Parameterised routes ──────────────────────────────────────────────────

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('insurance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'schemes_update',
    summary:     'Update insurance scheme',
    description: 'Applies a partial update to an existing insurance scheme.',
  })
  @ApiParam({ name: 'id', description: 'Scheme UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated scheme', type: InsuranceSchemeResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Scheme not found' })
  async update(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     dto: UpdateInsuranceSchemeDto,
    @Req()                      req: Request,
  ): Promise<InsuranceSchemeResponseDto> {
    return this.schemeService.update(id, dto, req.userId);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @Permissions('insurance:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'schemes_delete',
    summary:     'Soft-delete insurance scheme',
    description: 'Soft-deletes an insurance scheme. The record is retained for audit purposes.',
  })
  @ApiParam({ name: 'id', description: 'Scheme UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Scheme deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Scheme not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<void> {
    return this.schemeService.softDelete(id, req.userId);
  }

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'schemes_findById',
    summary:     'Get insurance scheme by ID',
    description: 'Returns a single insurance scheme including its parent provider details.',
  })
  @ApiParam({ name: 'id', description: 'Scheme UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Scheme',              type: InsuranceSchemeResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Scheme not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InsuranceSchemeResponseDto> {
    return this.schemeService.findById(id);
  }
}
