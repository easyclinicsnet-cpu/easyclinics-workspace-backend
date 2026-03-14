/**
 * Insurance Contracts Controller — v1
 *
 * Endpoints for managing facility–insurer contract master records.
 * Contracts define negotiated rates, coverage rules, and payment terms.
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/insurance/contracts                │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/insurance/contracts):
 *   POST   /                             — create contract
 *   GET    /                             — list (paginated, filtered)
 *   GET    /expiring                     — contracts expiring soon (?days)
 *   GET    /provider/:providerId         — all contracts for a provider
 *   PATCH  /:id                          — partial update
 *   DELETE /:id                          — soft-delete
 *   GET    /:id                          — get by UUID (LAST)
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

import { WorkspaceJwtGuard } from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }        from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }  from '../../../common/security/auth/permissions.guard';
import { Roles, Permissions } from '../../../common/security/auth/decorators';
import { UserRole } from '../../../common/enums';

import { InsuranceContractService } from '../services/insurance-contract.service';
import {
  CreateInsuranceContractDto,
  UpdateInsuranceContractDto,
  QueryInsuranceContractDto,
  InsuranceContractResponseDto,
} from '../dtos';
import { IPaginatedResult } from '../interfaces';

const VIEWER_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.BILLING_STAFF,
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

@ApiTags('Insurance — Contracts')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'insurance/contracts', version: 'v1' })
export class InsuranceContractController {
  constructor(private readonly contractService: InsuranceContractService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('insurance:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'contracts_create',
    summary:     'Create insurance contract',
    description: 'Creates a new contract between the facility and an insurance provider.',
  })
  @ApiResponse({ status: 201, description: 'Contract created',        type: InsuranceContractResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Insurance provider not found' })
  @ApiResponse({ status: 409, description: 'Contract number already exists' })
  async create(
    @Body() dto: CreateInsuranceContractDto,
    @Req()  req: Request,
  ): Promise<InsuranceContractResponseDto> {
    return this.contractService.create(dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // LIST
  // ==========================================================================

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'contracts_findAll',
    summary:     'List insurance contracts',
    description: 'Returns a paginated list of insurance contracts.',
  })
  @ApiResponse({ status: 200, description: 'Paginated contract list', type: [InsuranceContractResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: QueryInsuranceContractDto,
    @Req()   req: Request,
  ): Promise<IPaginatedResult<InsuranceContractResponseDto>> {
    return this.contractService.findAll(query, req.workspaceId);
  }

  // ==========================================================================
  // STATIC ROUTES — before /:id
  // ==========================================================================

  @Get('expiring')
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'contracts_expiringSoon',
    summary:     'Get contracts expiring soon',
    description: 'Returns active contracts expiring within the given number of days (default 30).',
  })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Lookahead window in days (default: 30)' })
  @ApiResponse({ status: 200, description: 'Expiring contracts', type: [InsuranceContractResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getExpiringSoon(
    @Query('days') days: string | undefined,
    @Req()         req:  Request,
  ): Promise<InsuranceContractResponseDto[]> {
    return this.contractService.findExpiringSoon(
      req.workspaceId,
      days !== undefined ? Number(days) : undefined,
    );
  }

  @Get('provider/:providerId')
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'contracts_byProvider',
    summary:     'Get contracts by provider',
    description: 'Returns all active contracts for a specific insurance provider.',
  })
  @ApiParam({ name: 'providerId', description: 'Insurance provider UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Contracts for provider', type: [InsuranceContractResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findByProvider(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Req()                              req:        Request,
  ): Promise<InsuranceContractResponseDto[]> {
    return this.contractService.findByProvider(providerId, req.workspaceId);
  }

  // ==========================================================================
  // UPDATE / DELETE
  // ==========================================================================

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('insurance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'contracts_update',
    summary:     'Update insurance contract',
    description: 'Applies a partial update to an existing insurance contract.',
  })
  @ApiParam({ name: 'id', description: 'Contract UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated contract', type: InsuranceContractResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  async update(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     dto: UpdateInsuranceContractDto,
    @Req()                      req: Request,
  ): Promise<InsuranceContractResponseDto> {
    return this.contractService.update(id, dto, req.userId);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @Permissions('insurance:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'contracts_delete',
    summary:     'Soft-delete insurance contract',
    description: 'Soft-deletes an insurance contract. The record is retained for audit purposes.',
  })
  @ApiParam({ name: 'id', description: 'Contract UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Contract deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<void> {
    return this.contractService.softDelete(id, req.userId);
  }

  // ==========================================================================
  // GET BY ID — LAST
  // ==========================================================================

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'contracts_findById',
    summary:     'Get insurance contract by ID',
    description: 'Returns a single insurance contract with its provider and scheme details.',
  })
  @ApiParam({ name: 'id', description: 'Contract UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Contract',             type: InsuranceContractResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InsuranceContractResponseDto> {
    return this.contractService.findById(id);
  }
}
