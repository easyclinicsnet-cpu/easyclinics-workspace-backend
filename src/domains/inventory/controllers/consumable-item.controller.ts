/**
 * Consumable Items Controller — v1
 *
 * CRUD endpoints for consumable inventory items (bandages, syringes, gloves, etc.).
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/inventory/consumables              │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/inventory/consumables):
 *   POST   /              — create consumable item
 *   GET    /              — list (paginated, filtered)
 *   GET    /low-stock     — below reorder threshold
 *   GET    /out-of-stock  — quantity = 0
 *   GET    /code/:code    — lookup by item code
 *   PATCH  /:id           — update item
 *   DELETE /:id           — soft-delete item
 *   GET    /:id           — get by UUID (LAST)
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
import { ConsumableItemService } from '../services/consumable-item.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateConsumableItemDto,
  UpdateConsumableItemDto,
  QueryConsumableItemDto,
  ConsumableItemResponseDto,
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

const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
];

// ---------------------------------------------------------------------------

@ApiTags('Inventory — Consumables')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'inventory/consumables', version: 'v1' })
export class ConsumableItemController {
  constructor(private readonly consumableService: ConsumableItemService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'consumables_create',
    summary:     'Create consumable item',
    description: 'Creates a new consumable item in the workspace inventory. workspaceId is injected from the verified JWT.',
  })
  @ApiResponse({ status: 201, description: 'Consumable item created',      type: ConsumableItemResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'Consumable code already exists in this workspace' })
  async create(
    @Body() dto: CreateConsumableItemDto,
    @Req()  req: Request,
  ): Promise<ConsumableItemResponseDto> {
    return this.consumableService.create({ ...dto, workspaceId: req.workspaceId });
  }

  // ==========================================================================
  // LIST (paginated)
  // ==========================================================================

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consumables_findAll',
    summary:     'List consumable items',
    description: 'Returns a paginated list of consumable items scoped to the workspace.',
  })
  @ApiResponse({ status: 200, description: 'Paginated consumable items', type: [ConsumableItemResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: QueryConsumableItemDto,
    @Req()   req:   Request,
  ): Promise<IPaginatedResult<ConsumableItemResponseDto>> {
    return this.consumableService.findAll(req.workspaceId, query);
  }

  // ==========================================================================
  // STATIC FILTER ROUTES — declared before /:id to avoid param collision
  // ==========================================================================

  @Get('low-stock')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consumables_lowStock',
    summary:     'Get low-stock consumables',
    description: 'Returns consumable items whose current stock has fallen at or below their reorder threshold.',
  })
  @ApiResponse({ status: 200, description: 'Low-stock consumable items', type: [ConsumableItemResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getLowStock(@Req() req: Request): Promise<ConsumableItemResponseDto[]> {
    return this.consumableService.findLowStock(req.workspaceId);
  }

  @Get('out-of-stock')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consumables_outOfStock',
    summary:     'Get out-of-stock consumables',
    description: 'Returns consumable items that are completely out of stock (availableQuantity = 0).',
  })
  @ApiResponse({ status: 200, description: 'Out-of-stock consumable items', type: [ConsumableItemResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getOutOfStock(@Req() req: Request): Promise<ConsumableItemResponseDto[]> {
    return this.consumableService.findOutOfStock(req.workspaceId);
  }

  // ==========================================================================
  // LOOKUP BY CODE — 2-segment route, no collision with /:id
  // ==========================================================================

  @Get('code/:code')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consumables_findByCode',
    summary:     'Find consumable by item code',
    description: 'Looks up a single consumable item by its unique item code within the workspace.',
  })
  @ApiParam({ name: 'code', description: 'Item code (e.g. CON-001)', type: String })
  @ApiResponse({ status: 200, description: 'Consumable item',       type: ConsumableItemResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Consumable not found' })
  async findByCode(
    @Param('code') code: string,
    @Req()         req:  Request,
  ): Promise<ConsumableItemResponseDto> {
    return this.consumableService.findByCode(req.workspaceId, code);
  }

  // ==========================================================================
  // UPDATE / DELETE — parameterised, before GET /:id
  // ==========================================================================

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consumables_update',
    summary:     'Update consumable item',
    description: 'Applies a partial update to an existing consumable item.',
  })
  @ApiParam({ name: 'id', description: 'Consumable item UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated consumable item', type: ConsumableItemResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Consumable not found' })
  async update(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     dto: UpdateConsumableItemDto,
    @Req()                      req: Request,
  ): Promise<ConsumableItemResponseDto> {
    return this.consumableService.update(req.workspaceId, id, dto);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @Permissions('inventory:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'consumables_delete',
    summary:     'Soft-delete consumable item',
    description: 'Soft-deletes a consumable item from the workspace inventory. The record is retained in the database for audit purposes.',
  })
  @ApiParam({ name: 'id', description: 'Consumable item UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Consumable item deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Consumable not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<void> {
    return this.consumableService.softDelete(req.workspaceId, id, req.userId);
  }

  // ==========================================================================
  // GET BY ID — LAST to avoid swallowing static segment routes
  // ==========================================================================

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'consumables_findById',
    summary:     'Get consumable item by ID',
    description: 'Returns a single consumable item with its associated batches.',
  })
  @ApiParam({ name: 'id', description: 'Consumable item UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Consumable item',    type: ConsumableItemResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Consumable not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<ConsumableItemResponseDto> {
    return this.consumableService.findById(req.workspaceId, id);
  }
}
