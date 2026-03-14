/**
 * Inventory Audit Controller — v1
 *
 * Endpoints for recording and retrieving inventory audit events
 * (stocktakes, discrepancy reports, reconciliations).
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/inventory/audit                    │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/inventory/audit):
 *   POST   /   — record an audit event
 *   GET    /   — list audit events (paginated, filtered)
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
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
import { InventoryAuditService } from '../services/inventory-audit.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateInventoryAuditDto,
  QueryInventoryAuditDto,
  InventoryAuditResponseDto,
} from '../dtos';

// ── Domain interfaces ─────────────────────────────────────────────────────────
import { IPaginatedResult } from '../interfaces';

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

/** Roles permitted to read audit records */
const AUDIT_READ_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.PHARMACIST,
];

/** Roles permitted to create manual audit records (e.g. stocktake) */
const AUDIT_WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.PHARMACIST,
  UserRole.MEDICAL_ASSISTANT,
];

// ---------------------------------------------------------------------------

@ApiTags('Inventory — Audit')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'inventory/audit', version: 'v1' })
export class InventoryAuditController {
  constructor(private readonly auditService: InventoryAuditService) {}

  // ==========================================================================
  // CREATE AUDIT RECORD
  // ==========================================================================

  @Post()
  @Roles(...AUDIT_WRITE_ROLES)
  @Permissions('inventory:audit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'inventoryAudit_create',
    summary:     'Create inventory audit record',
    description:
      'Records a manual inventory audit event (e.g. stocktake, discrepancy report, reconciliation). ' +
      'workspaceId is injected from the verified JWT.',
  })
  @ApiResponse({ status: 201, description: 'Audit record created', type: InventoryAuditResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(
    @Body() dto: CreateInventoryAuditDto,
    @Req()  req: Request,
  ): Promise<InventoryAuditResponseDto> {
    return this.auditService.create({ ...dto, workspaceId: req.workspaceId });
  }

  // ==========================================================================
  // LIST AUDIT RECORDS (paginated)
  // ==========================================================================

  @Get()
  @Roles(...AUDIT_READ_ROLES)
  @Permissions('inventory:audit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'inventoryAudit_findAll',
    summary:     'List inventory audit records',
    description: 'Returns a paginated list of inventory audit events scoped to the workspace.',
  })
  @ApiResponse({ status: 200, description: 'Paginated audit records', type: [InventoryAuditResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: QueryInventoryAuditDto,
    @Req()   req:   Request,
  ): Promise<IPaginatedResult<InventoryAuditResponseDto>> {
    return this.auditService.findAll(req.workspaceId, query);
  }
}
