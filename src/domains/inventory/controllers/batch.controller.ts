/**
 * Inventory Batches Controller — v1
 *
 * Endpoints for managing inventory batches (lot tracking, expiry, availability).
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/inventory/batches                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/inventory/batches):
 *   POST   /                          — create batch
 *   GET    /                          — list (paginated, filtered)
 *   GET    /expiring                  — expiring within ?days (default threshold)
 *   GET    /expired                   — already expired
 *   GET    /available/:itemType/:itemId — available batches for a specific item
 *   PATCH  /:id                       — update batch
 *   GET    /:id                       — get by UUID (LAST — no delete on BatchService)
 */

import {
  Controller,
  Get,
  Post,
  Patch,
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

// ── Guards ────────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard } from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }        from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }  from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC enums ────────────────────────────────────────────────────────────────
import { ItemType, UserRole } from '../../../common/enums';

// ── Domain service ────────────────────────────────────────────────────────────
import { BatchService } from '../services/batch.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateBatchDto,
  UpdateBatchDto,
  QueryBatchDto,
  BatchResponseDto,
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
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.BILLING_STAFF,
  UserRole.PHARMACIST,
  UserRole.THERAPIST,
];

const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.PHARMACIST,
  UserRole.MEDICAL_ASSISTANT,
];

// ---------------------------------------------------------------------------

@ApiTags('Inventory — Batches')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'inventory/batches', version: 'v1' })
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'batches_create',
    summary:     'Create inventory batch',
    description: 'Creates a new batch (lot) for a medication or consumable item. Automatically updates the parent item\'s stock quantities. workspaceId is injected from the verified JWT.',
  })
  @ApiResponse({ status: 201, description: 'Batch created',      type: BatchResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error or invalid date range' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'Batch number already exists in this workspace' })
  async create(
    @Body() dto: CreateBatchDto,
    @Req()  req: Request,
  ): Promise<BatchResponseDto> {
    return this.batchService.create({ ...dto, workspaceId: req.workspaceId, createdBy: req.userId });
  }

  // ==========================================================================
  // LIST (paginated)
  // ==========================================================================

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_findAll',
    summary:     'List inventory batches',
    description: 'Returns a paginated list of batches scoped to the workspace.',
  })
  @ApiResponse({ status: 200, description: 'Paginated batch list', type: [BatchResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: QueryBatchDto,
    @Req()   req:   Request,
  ): Promise<IPaginatedResult<BatchResponseDto>> {
    return this.batchService.findAll(req.workspaceId, query);
  }

  // ==========================================================================
  // STATIC FILTER ROUTES — declared before /:id to avoid param collision
  // ==========================================================================

  @Get('expiring')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_expiringSoon',
    summary:     'Get batches expiring soon',
    description: 'Returns batches expiring within the given number of days (defaults to the configured threshold when omitted).',
  })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Lookahead window in days (e.g. 30)' })
  @ApiResponse({ status: 200, description: 'Expiring batches', type: [BatchResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getExpiringSoon(
    @Query('days') days: string | undefined,
    @Req()         req:  Request,
  ): Promise<BatchResponseDto[]> {
    return this.batchService.findExpiringSoon(
      req.workspaceId,
      days !== undefined ? Number(days) : undefined,
    );
  }

  @Get('expired')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_expired',
    summary:     'Get expired batches',
    description: 'Returns all batches that have passed their expiry date and are no longer available for dispensing.',
  })
  @ApiResponse({ status: 200, description: 'Expired batches', type: [BatchResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getExpired(@Req() req: Request): Promise<BatchResponseDto[]> {
    return this.batchService.findExpired(req.workspaceId);
  }

  // ==========================================================================
  // AVAILABLE BATCHES BY ITEM — 3-segment route, no collision with /:id
  // ==========================================================================

  @Get('available/:itemType/:itemId')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_availableForItem',
    summary:     'Get available batches for an item',
    description: 'Returns all non-expired, non-quarantined batches that have available stock for the specified item. Ordered by FEFO (First Expired, First Out).',
  })
  @ApiParam({ name: 'itemType', description: 'Item type (MEDICATION | CONSUMABLE)', enum: ItemType })
  @ApiParam({ name: 'itemId',   description: 'Item UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Available batches for item', type: [BatchResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getAvailableForItem(
    @Param('itemType')              itemType: ItemType,
    @Param('itemId', ParseUUIDPipe) itemId:   string,
    @Req()                          req:      Request,
  ): Promise<BatchResponseDto[]> {
    return this.batchService.findAvailableForItem(req.workspaceId, itemId, itemType);
  }

  // ==========================================================================
  // UPDATE — parameterised, before GET /:id
  // ==========================================================================

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_update',
    summary:     'Update batch',
    description: 'Applies a partial update to an existing batch (e.g. quarantine status, unit cost, notes).',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated batch', type: BatchResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  async update(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     dto: UpdateBatchDto,
    @Req()                      req: Request,
  ): Promise<BatchResponseDto> {
    return this.batchService.update(req.workspaceId, id, { ...dto, updatedBy: req.userId });
  }

  // ==========================================================================
  // GET BY ID — LAST to avoid swallowing static segment routes
  // (BatchService has no softDelete — no DELETE route)
  // ==========================================================================

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_findById',
    summary:     'Get batch by ID',
    description: 'Returns a single batch with its associated item and supplier details.',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Batch',           type: BatchResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<BatchResponseDto> {
    return this.batchService.findById(req.workspaceId, id);
  }
}
