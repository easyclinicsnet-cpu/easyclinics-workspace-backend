/**
 * Suppliers Controller — v1
 *
 * CRUD endpoints for inventory suppliers.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/inventory/suppliers                │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/inventory/suppliers):
 *   POST   /       — create supplier
 *   GET    /       — list (paginated, filtered)
 *   PATCH  /:id    — update supplier
 *   DELETE /:id    — soft-delete supplier
 *   GET    /:id    — get by UUID (LAST)
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

// ── Guards ────────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard } from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }        from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }  from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC enums ────────────────────────────────────────────────────────────────
import { UserRole } from '../../../common/enums';

// ── Domain service ────────────────────────────────────────────────────────────
import { SupplierService } from '../services/supplier.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateSupplierDto,
  UpdateSupplierDto,
  QuerySupplierDto,
  SupplierResponseDto,
} from '../dtos';

// ── Domain interfaces ─────────────────────────────────────────────────────────
import { IPaginatedResult } from '../interfaces';

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

const VIEWER_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.PHARMACIST,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.BILLING_STAFF,
];

const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.PHARMACIST,
];

const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
];

// ---------------------------------------------------------------------------

@ApiTags('Inventory — Suppliers')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'inventory/suppliers', version: 'v1' })
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'suppliers_create',
    summary:     'Create supplier',
    description: 'Creates a new inventory supplier for the workspace. workspaceId is injected from the verified JWT.',
  })
  @ApiResponse({ status: 201, description: 'Supplier created',      type: SupplierResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(
    @Body() dto: CreateSupplierDto,
    @Req()  req: Request,
  ): Promise<SupplierResponseDto> {
    return this.supplierService.create({ ...dto, workspaceId: req.workspaceId });
  }

  // ==========================================================================
  // LIST (paginated)
  // ==========================================================================

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'suppliers_findAll',
    summary:     'List suppliers',
    description: 'Returns a paginated list of inventory suppliers scoped to the workspace.',
  })
  @ApiResponse({ status: 200, description: 'Paginated supplier list', type: [SupplierResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: QuerySupplierDto,
    @Req()   req:   Request,
  ): Promise<IPaginatedResult<SupplierResponseDto>> {
    return this.supplierService.findAll(req.workspaceId, query);
  }

  // ==========================================================================
  // UPDATE / DELETE — parameterised, before GET /:id
  // ==========================================================================

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'suppliers_update',
    summary:     'Update supplier',
    description: 'Applies a partial update to an existing supplier.',
  })
  @ApiParam({ name: 'id', description: 'Supplier UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated supplier', type: SupplierResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  async update(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     dto: UpdateSupplierDto,
    @Req()                      req: Request,
  ): Promise<SupplierResponseDto> {
    return this.supplierService.update(req.workspaceId, id, dto);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @Permissions('inventory:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'suppliers_delete',
    summary:     'Soft-delete supplier',
    description: 'Soft-deletes a supplier record. The record is retained for audit purposes.',
  })
  @ApiParam({ name: 'id', description: 'Supplier UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Supplier deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<void> {
    return this.supplierService.softDelete(req.workspaceId, id, req.userId);
  }

  // ==========================================================================
  // GET BY ID — LAST
  // ==========================================================================

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'suppliers_findById',
    summary:     'Get supplier by ID',
    description: 'Returns a single supplier by its UUID.',
  })
  @ApiParam({ name: 'id', description: 'Supplier UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Supplier',        type: SupplierResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<SupplierResponseDto> {
    return this.supplierService.findById(req.workspaceId, id);
  }
}
