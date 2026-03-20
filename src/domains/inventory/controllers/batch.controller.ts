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
 *   GET    /statistics/summary        — aggregate batch counts & stock value
 *   GET    /alerts/statistics         — alert counts (expired, critical, quarantined, QC failed)
 *   GET    /dashboard                 — combined statistics + alerts
 *   GET    /low-stock/:threshold      — batches below stock threshold percentage
 *   GET    /available/:itemType/:itemId — available batches for a specific item
 *   POST   /:id/adjust-quantity       — add/remove quantity with audit trail
 *   PATCH  /:id/delete                — soft-delete (zero-stock batches only)
 *   PATCH  /:id                       — update batch
 *   GET    /:id                       — get by UUID (LAST)
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
  // STATISTICS
  // ==========================================================================

  @Get('statistics/summary')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_statisticsSummary',
    summary:     'Batch statistics summary',
    description: 'Returns aggregate batch counts and stock value for the workspace dashboard.',
  })
  @ApiResponse({ status: 200, description: 'Statistics summary' })
  async getStatisticsSummary(@Req() req: Request): Promise<Record<string, any>> {
    return this.batchService.getStatisticsSummary(req.workspaceId);
  }

  @Get('alerts/statistics')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_alertsStatistics',
    summary:     'Batch alert statistics',
    description: 'Returns counts for batch-level alerts: expired, critical expiry, warning expiry, quarantined, quality failed, depleted.',
  })
  @ApiResponse({ status: 200, description: 'Alert statistics' })
  async getAlertsStatistics(@Req() req: Request): Promise<Record<string, any>> {
    return this.batchService.getAlertsStatistics(req.workspaceId);
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
  // DASHBOARD (combined stats + alerts)
  // ==========================================================================

  @Get('dashboard')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_dashboard',
    summary:     'Get batch dashboard data',
    description: 'Returns combined statistics and alerts for the inventory dashboard.',
  })
  @ApiResponse({ status: 200, description: 'Dashboard data' })
  async getDashboard(@Req() req: Request): Promise<Record<string, any>> {
    return this.batchService.getDashboard(req.workspaceId);
  }

  // ==========================================================================
  // LOW STOCK
  // ==========================================================================

  @Get('low-stock/:threshold')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_lowStock',
    summary:     'Get low-stock batches',
    description: 'Returns batches with available quantity below the given threshold percentage of initial quantity.',
  })
  @ApiParam({ name: 'threshold', description: 'Stock threshold percentage (0-100)', type: Number })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated low-stock batches' })
  async getLowStock(
    @Param('threshold') threshold: string,
    @Query('page')  page:  string | undefined,
    @Query('limit') limit: string | undefined,
    @Req()          req:   Request,
  ): Promise<IPaginatedResult<BatchResponseDto>> {
    return this.batchService.findLowStock(
      req.workspaceId,
      Number(threshold),
      page ? Number(page) : 1,
      limit ? Number(limit) : 25,
    );
  }

  // ==========================================================================
  // ADJUST QUANTITY
  // ==========================================================================

  @Post(':id/adjust-quantity')
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_adjustQuantity',
    summary:     'Adjust batch quantity',
    description: 'Adds or removes quantity from a batch. Updates both the batch and parent item stock levels. Requires a reason for audit.',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'quantity',       required: true, type: Number, description: 'Positive quantity to adjust' })
  @ApiQuery({ name: 'adjustmentType', required: true, enum: ['ADD', 'REMOVE'] })
  @ApiQuery({ name: 'reason',         required: true, type: String, description: 'Reason for adjustment' })
  @ApiResponse({ status: 200, description: 'Adjusted batch', type: BatchResponseDto })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  @ApiResponse({ status: 409, description: 'Insufficient stock for removal' })
  async adjustQuantity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('quantity')       quantity:       string,
    @Query('adjustmentType') adjustmentType: 'ADD' | 'REMOVE',
    @Query('reason')         reason:         string,
    @Req()                   req:            Request,
  ): Promise<BatchResponseDto> {
    return this.batchService.adjustQuantity(
      req.workspaceId, id, Number(quantity), adjustmentType, reason, req.userId,
    );
  }

  // ==========================================================================
  // SOFT DELETE
  // ==========================================================================

  @Patch(':id/delete')
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'batches_softDelete',
    summary:     'Soft-delete batch',
    description: 'Marks a batch as deleted. Only works on batches with zero available stock.',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Deleted batch', type: BatchResponseDto })
  @ApiResponse({ status: 404, description: 'Batch not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete batch with remaining stock' })
  async softDelete(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     body: { reason?: string },
    @Req()                      req:  Request,
  ): Promise<BatchResponseDto> {
    return this.batchService.softDelete(req.workspaceId, id, req.userId, body?.reason);
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
