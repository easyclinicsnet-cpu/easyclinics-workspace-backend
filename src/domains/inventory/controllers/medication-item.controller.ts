/**
 * Medication Items Controller — v1
 *
 * CRUD endpoints for medication inventory items.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/inventory/medications              │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/inventory/medications):
 *   POST   /                      — create medication item
 *   GET    /                      — list (paginated, filtered)
 *   GET    /low-stock             — below reorder threshold
 *   GET    /out-of-stock          — quantity = 0
 *   GET    /prescription          — prescription-only items
 *   GET    /controlled-substances — controlled substance items
 *   GET    /code/:code            — lookup by item code
 *   PATCH  /:id                   — update item
 *   DELETE /:id                   — soft-delete item
 *   GET    /:id                   — get by UUID (LAST — avoids swallowing static paths)
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
import { MedicationItemService } from '../services/medication-item.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateMedicationItemDto,
  UpdateMedicationItemDto,
  QueryMedicationItemDto,
  MedicationItemResponseDto,
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

@ApiTags('Inventory — Medications')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'inventory/medications', version: 'v1' })
export class MedicationItemController {
  constructor(private readonly medicationService: MedicationItemService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'medications_create',
    summary:     'Create medication item',
    description: 'Creates a new medication item in the workspace inventory. workspaceId is injected from the verified JWT.',
  })
  @ApiResponse({ status: 201, description: 'Medication item created',      type: MedicationItemResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'Medication code already exists in this workspace' })
  async create(
    @Body() dto: CreateMedicationItemDto,
    @Req()  req: Request,
  ): Promise<MedicationItemResponseDto> {
    return this.medicationService.create({ ...dto, workspaceId: req.workspaceId });
  }

  // ==========================================================================
  // LIST (paginated)
  // ==========================================================================

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medications_findAll',
    summary:     'List medication items',
    description: 'Returns a paginated list of medication items scoped to the workspace.',
  })
  @ApiResponse({ status: 200, description: 'Paginated medication items', type: [MedicationItemResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: QueryMedicationItemDto,
    @Req()   req:   Request,
  ): Promise<IPaginatedResult<MedicationItemResponseDto>> {
    return this.medicationService.findAll(req.workspaceId, query);
  }

  // ==========================================================================
  // STATIC FILTER ROUTES — declared before /:id to avoid param collision
  // ==========================================================================

  @Get('low-stock')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medications_lowStock',
    summary:     'Get low-stock medications',
    description: 'Returns medication items whose current stock has fallen at or below their reorder threshold.',
  })
  @ApiResponse({ status: 200, description: 'Low-stock medication items', type: [MedicationItemResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getLowStock(@Req() req: Request): Promise<MedicationItemResponseDto[]> {
    return this.medicationService.findLowStock(req.workspaceId);
  }

  @Get('out-of-stock')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medications_outOfStock',
    summary:     'Get out-of-stock medications',
    description: 'Returns medication items that are completely out of stock (availableQuantity = 0).',
  })
  @ApiResponse({ status: 200, description: 'Out-of-stock medication items', type: [MedicationItemResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getOutOfStock(@Req() req: Request): Promise<MedicationItemResponseDto[]> {
    return this.medicationService.findOutOfStock(req.workspaceId);
  }

  @Get('prescription')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medications_prescription',
    summary:     'Get prescription-only medications',
    description: 'Returns medication items flagged as requiring a valid prescription before dispensing.',
  })
  @ApiResponse({ status: 200, description: 'Prescription medication items', type: [MedicationItemResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getPrescriptionItems(@Req() req: Request): Promise<MedicationItemResponseDto[]> {
    return this.medicationService.findPrescriptionItems(req.workspaceId);
  }

  @Get('controlled-substances')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medications_controlledSubstances',
    summary:     'Get controlled substances',
    description: 'Returns medication items classified as controlled substances requiring enhanced tracking.',
  })
  @ApiResponse({ status: 200, description: 'Controlled substance medication items', type: [MedicationItemResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getControlledSubstances(@Req() req: Request): Promise<MedicationItemResponseDto[]> {
    return this.medicationService.findControlledSubstances(req.workspaceId);
  }

  // ==========================================================================
  // LOOKUP BY CODE — 2-segment route, no collision with /:id
  // ==========================================================================

  @Get('code/:code')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medications_findByCode',
    summary:     'Find medication by item code',
    description: 'Looks up a single medication item by its unique item code within the workspace.',
  })
  @ApiParam({ name: 'code', description: 'Item code (e.g. MED-001)', type: String })
  @ApiResponse({ status: 200, description: 'Medication item',       type: MedicationItemResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  async findByCode(
    @Param('code') code: string,
    @Req()         req:  Request,
  ): Promise<MedicationItemResponseDto> {
    return this.medicationService.findByCode(req.workspaceId, code);
  }

  // ==========================================================================
  // UPDATE / DELETE — parameterised, before GET /:id
  // ==========================================================================

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('inventory:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medications_update',
    summary:     'Update medication item',
    description: 'Applies a partial update to an existing medication item.',
  })
  @ApiParam({ name: 'id', description: 'Medication item UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated medication item', type: MedicationItemResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  async update(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     dto: UpdateMedicationItemDto,
    @Req()                      req: Request,
  ): Promise<MedicationItemResponseDto> {
    return this.medicationService.update(req.workspaceId, id, dto);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @Permissions('inventory:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'medications_delete',
    summary:     'Soft-delete medication item',
    description: 'Soft-deletes a medication item from the workspace inventory. The record is retained in the database for audit purposes.',
  })
  @ApiParam({ name: 'id', description: 'Medication item UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Medication item deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<void> {
    return this.medicationService.softDelete(req.workspaceId, id, req.userId);
  }

  // ==========================================================================
  // GET BY ID — LAST to avoid swallowing static segment routes
  // ==========================================================================

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('inventory:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'medications_findById',
    summary:     'Get medication item by ID',
    description: 'Returns a single medication item with its associated batches.',
  })
  @ApiParam({ name: 'id', description: 'Medication item UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Medication item',    type: MedicationItemResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Medication not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<MedicationItemResponseDto> {
    return this.medicationService.findById(req.workspaceId, id);
  }
}
