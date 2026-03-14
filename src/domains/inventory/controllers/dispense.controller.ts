/**
 * Dispense Controller — v1
 *
 * Endpoints for dispensing medication and consumable items from inventory.
 * Supports standard and emergency dispense flows with full transactional
 * batch deduction and movement recording.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/inventory/dispensing               │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/inventory/dispensing):
 *   POST   /single     — standard dispense (single/batch items, FEFO strategy)
 *   POST   /emergency  — emergency dispense (overrides expiry/quality locks if authorised)
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  ParseUUIDPipe,
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

// ── RBAC enums ────────────────────────────────────────────────────────────────
import { UserRole } from '../../../common/enums';

// ── Domain service ────────────────────────────────────────────────────────────
import { DispenseService } from '../services/dispense.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  DispenseRequestDto,
  EmergencyDispenseRequestDto,
  DispenseResponseDto,
  QueryDispenseHistoryDto,
  PaginatedDispenseHistoryDto,
} from '../dtos';

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

/** All clinical and pharmacy staff permitted to initiate standard dispenses */
const DISPENSE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.PHARMACIST,
];

/** Emergency dispense is restricted to authorised clinical leads */
const EMERGENCY_DISPENSE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.PHARMACIST,
];

// ---------------------------------------------------------------------------

@ApiTags('Inventory — Dispensing')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'inventory/dispensing', version: 'v1' })
export class DispenseController {
  constructor(private readonly dispenseService: DispenseService) {}

  // ==========================================================================
  // STANDARD DISPENSE
  // ==========================================================================

  @Post('single')
  @Roles(...DISPENSE_ROLES)
  @Permissions('inventory:dispense')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'dispensing_single',
    summary:     'Dispense items (standard)',
    description:
      'Dispenses one or more medication/consumable items from inventory using the FEFO batch selection strategy. ' +
      'Runs as a single atomic transaction — all items are deducted or the entire operation is rolled back. ' +
      'Supports idempotency via the optional idempotencyKey field. ' +
      'workspaceId and dispensedBy are injected from the verified JWT.',
  })
  @ApiBody({ type: DispenseRequestDto })
  @ApiResponse({ status: 201, description: 'Dispense successful',         type: DispenseResponseDto })
  @ApiResponse({ status: 400, description: 'Insufficient stock or invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Item or batch not found' })
  async dispense(
    @Body() dto: DispenseRequestDto,
    @Req()  req: Request,
  ): Promise<DispenseResponseDto> {
    return this.dispenseService.dispense({
      ...dto,
      workspaceId: req.workspaceId,
      dispensedBy: dto.dispensedBy ?? req.userId,
    });
  }

  // ==========================================================================
  // EMERGENCY DISPENSE
  // ==========================================================================

  @Post('emergency')
  @Roles(...EMERGENCY_DISPENSE_ROLES)
  @Permissions('inventory:dispense')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'dispensing_emergency',
    summary:     'Emergency dispense',
    description:
      'Performs an emergency dispense that can override standard batch locks (expired, quarantined) when ' +
      'authorised by a physician or pharmacist. A secondary audit log entry is created for all overrides. ' +
      'workspaceId and dispensedBy are injected from the verified JWT.',
  })
  @ApiBody({ type: EmergencyDispenseRequestDto })
  @ApiResponse({ status: 201, description: 'Emergency dispense successful', type: DispenseResponseDto })
  @ApiResponse({ status: 400, description: 'Insufficient stock or invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — emergency dispense requires DOCTOR or PHARMACIST role' })
  @ApiResponse({ status: 404, description: 'Item or batch not found' })
  async emergencyDispense(
    @Body() dto: EmergencyDispenseRequestDto,
    @Req()  req: Request,
  ): Promise<DispenseResponseDto> {
    return this.dispenseService.emergencyDispense({
      ...dto,
      workspaceId: req.workspaceId,
      dispensedBy: dto.dispensedBy ?? req.userId,
    });
  }

  // ==========================================================================
  // HISTORY
  // ==========================================================================

  @Get('history')
  @Roles(...DISPENSE_ROLES)
  @ApiOperation({
    operationId: 'dispensing_history',
    summary: 'Get dispense history',
    description: 'Returns paginated dispense records for the workspace, with optional filters.',
  })
  @ApiResponse({ status: 200, type: PaginatedDispenseHistoryDto })
  async getHistory(
    @Query() query: QueryDispenseHistoryDto,
    @Req()   req: Request,
  ): Promise<PaginatedDispenseHistoryDto> {
    if (query.appointmentId) {
      return this.dispenseService.getAppointmentDispenseHistory(req.workspaceId, query.appointmentId, query);
    }
    return this.dispenseService.getDispenseHistory(req.workspaceId, query);
  }

  @Get('history/patients/:patientId')
  @Roles(...DISPENSE_ROLES)
  @ApiOperation({ summary: 'Get dispense history for a patient' })
  @ApiParam({ name: 'patientId', type: String })
  @ApiResponse({ status: 200, type: PaginatedDispenseHistoryDto })
  async getPatientHistory(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: QueryDispenseHistoryDto,
    @Req()   req: Request,
  ): Promise<PaginatedDispenseHistoryDto> {
    return this.dispenseService.getPatientDispenseHistory(req.workspaceId, patientId, query);
  }

  @Get('history/appointments/:appointmentId')
  @Roles(...DISPENSE_ROLES)
  @ApiOperation({ summary: 'Get dispense history for an appointment' })
  @ApiParam({ name: 'appointmentId', type: String })
  @ApiResponse({ status: 200, type: PaginatedDispenseHistoryDto })
  async getAppointmentHistory(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Query() query: QueryDispenseHistoryDto,
    @Req()   req: Request,
  ): Promise<PaginatedDispenseHistoryDto> {
    return this.dispenseService.getAppointmentDispenseHistory(req.workspaceId, appointmentId, query);
  }

  @Get('history/items/:itemId')
  @Roles(...DISPENSE_ROLES)
  @ApiOperation({ summary: 'Get dispense history for a specific inventory item' })
  @ApiParam({ name: 'itemId', type: String })
  @ApiResponse({ status: 200, type: PaginatedDispenseHistoryDto })
  async getItemHistory(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Query() query: QueryDispenseHistoryDto,
    @Req()   req: Request,
  ): Promise<PaginatedDispenseHistoryDto> {
    return this.dispenseService.getItemDispenseHistory(req.workspaceId, itemId, query);
  }
}
