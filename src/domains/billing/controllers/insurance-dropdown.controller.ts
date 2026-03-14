/**
 * Insurance Dropdown Controller — v1
 *
 * Lightweight read-only endpoints that power cascading dropdown menus in the
 * insurance claim creation forms (provider → scheme lookup).
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  workspaceId is ALWAYS extracted from the verified JWT                    │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/insurance/dropdowns              │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/insurance/dropdowns):
 *   GET    /providers               — all providers (optionally filtered)
 *   GET    /schemes                 — all schemes (optionally filtered)
 *   GET    /providers/:id/schemes   — schemes for a specific provider (cascading)
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
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
import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC enums ────────────────────────────────────────────────────────────────
import { UserRole } from '../../../common/enums';

// ── Domain service ────────────────────────────────────────────────────────────
import { InsuranceDropdownService } from '../services/insurance-dropdown.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  DropdownFilterDto,
  ProviderDropdownDto,
  SchemeDropdownDto,
} from '../dto';

// ---------------------------------------------------------------------------
// Role shorthand groups
// Any authenticated workspace user may query dropdown data for form population.
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
  UserRole.LAB_TECHNICIAN,
  UserRole.RADIOLOGY_TECHNICIAN,
  UserRole.DOCTOR,
];

// ---------------------------------------------------------------------------

@ApiTags('Insurance Dropdowns')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'insurance/dropdowns', version: 'v1' })
export class InsuranceDropdownController {
  constructor(private readonly dropdownService: InsuranceDropdownService) {}

  // ==========================================================================
  // PROVIDERS — static path, no collision risk
  // ==========================================================================

  @Get('providers')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'dropdowns_providers',
    summary:     'Get insurance providers for dropdown',
    description: 'Returns a list of active insurance providers scoped to the workspace, suitable for use in select / autocomplete inputs.',
  })
  @ApiResponse({ status: 200, description: 'Provider dropdown list', type: [ProviderDropdownDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getProviders(
    @Query() filter: DropdownFilterDto,
    @Req() req: Request,
  ): Promise<ProviderDropdownDto[]> {
    return this.dropdownService.getProviderDropdown(filter, req.workspaceId);
  }

  // ==========================================================================
  // SCHEMES — static path
  // ==========================================================================

  @Get('schemes')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'dropdowns_schemes',
    summary:     'Get insurance schemes for dropdown',
    description: 'Returns a flat list of all active insurance schemes in the workspace.',
  })
  @ApiResponse({ status: 200, description: 'Scheme dropdown list', type: [SchemeDropdownDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getSchemes(
    @Query() filter: DropdownFilterDto,
    @Req() req: Request,
  ): Promise<SchemeDropdownDto[]> {
    return this.dropdownService.getSchemeDropdown(filter, req.workspaceId);
  }

  // ==========================================================================
  // SCHEMES BY PROVIDER — /providers/:id/schemes
  // 3-segment route (static / param / static) — no collision with /providers
  // (different segment count) or /schemes (different first segment)
  // ==========================================================================

  @Get('providers/:id/schemes')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'dropdowns_schemesByProvider',
    summary:     'Get schemes by provider (cascading)',
    description: 'Returns only the insurance schemes that belong to the specified provider. Used for cascading dropdown behaviour: select provider → populate scheme list.',
  })
  @ApiParam({ name: 'id', description: 'Insurance provider UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Scheme dropdown list for provider', type: [SchemeDropdownDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async getSchemesByProvider(
    @Param('id', ParseUUIDPipe) providerId: string,
    @Req() req: Request,
  ): Promise<SchemeDropdownDto[]> {
    return this.dropdownService.getSchemesByProvider(providerId, req.workspaceId);
  }
}
