/**
 * Consultation Join Request Controller — v1
 *
 * Manages the lifecycle of join requests that allow workspace users to
 * request access to a consultation they were not directly invited to.
 *
 * Lifecycle:  create (PENDING) → approve (→ adds as collaborator) | reject | cancel
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100 % through DTOs (ValidationPipe enforces)        │
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/consultations/:id/requests        │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1):
 *   POST   /consultations/:consultationId/requests                    — submit join request
 *   GET    /consultations/:consultationId/requests/pending            — pending requests (owner/admin)
 *   GET    /consultations/:consultationId/requests/my                 — current user's requests
 *   GET    /consultations/:consultationId/requests/:requestId         — single request
 *   POST   /consultations/:consultationId/requests/:requestId/approve — approve request
 *   POST   /consultations/:consultationId/requests/:requestId/reject  — reject request
 *   POST   /consultations/:consultationId/requests/:requestId/cancel  — cancel own request
 */

import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiExtraModels,
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
import { ConsultationJoinRequestService } from '../services/consultation-join-request.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateJoinRequestDto,
  JoinRequestResponseDto,
  PaginatedResponseDto,
} from '../dto';

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

/** Any clinical user who may submit a join request. */
const CLINICAL_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
  UserRole.PHARMACIST,
];

/** Roles that can approve or reject join requests. */
const APPROVER_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
];

// ---------------------------------------------------------------------------

@ApiTags('Consultation Join Requests')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(JoinRequestResponseDto, CreateJoinRequestDto)
@Controller({ path: 'consultations/:consultationId/requests', version: 'v1' })
export class ConsultationJoinRequestController {
  constructor(
    private readonly joinRequestService: ConsultationJoinRequestService,
  ) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  /**
   * POST /api/v1/consultations/:consultationId/requests
   *
   * The requesting user's JWT `userId` is injected as `userId` in the DTO
   * and the route param is merged as `consultationId`.
   */
  @Post()
  @Roles(...CLINICAL_ROLES)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'joinRequests_create',
    summary:     'Submit a join request',
    description:
      'Requests access to the specified consultation. ' +
      'If the consultation is open for direct joining, the user is added as a collaborator immediately. ' +
      'If approval is required, a PENDING join request is created.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Join request submitted',   type: JoinRequestResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  @ApiResponse({ status: 409, description: 'Conflict — already a collaborator or pending request exists' })
  async createJoinRequest(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Body() dto: CreateJoinRequestDto,
    @Req() req: Request,
  ): Promise<JoinRequestResponseDto> {
    return this.joinRequestService.createJoinRequest(
      { ...dto, consultationId },
      req.workspaceId,
    );
  }

  // ==========================================================================
  // READ — static paths declared BEFORE parameterised /:requestId
  // ==========================================================================

  /**
   * GET /api/v1/consultations/:consultationId/requests/pending?page=1&limit=10
   */
  @Get('pending')
  @Roles(...APPROVER_ROLES)
  @Permissions('consultations:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'joinRequests_pending',
    summary:     'Get pending join requests',
    description: 'Returns all PENDING join requests for the specified consultation. Restricted to approvers.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Pending join requests', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — approver role required' })
  async getPendingRequests(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<JoinRequestResponseDto>> {
    return this.joinRequestService.getPendingRequests(
      consultationId,
      req.workspaceId,
      page,
      limit,
    );
  }

  /**
   * GET /api/v1/consultations/:consultationId/requests/my?page=1&limit=10
   *
   * Returns the current user's own join requests across all consultations in
   * the workspace (consultationId in the path is used for URL consistency but
   * the service scopes by userId + workspaceId).
   */
  @Get('my')
  @Roles(...CLINICAL_ROLES)
  @Permissions('consultations:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'joinRequests_my',
    summary:     'Get current user\'s join requests',
    description: 'Returns all join requests initiated by the authenticated user in this workspace.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'User join requests', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getUserRequests(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<JoinRequestResponseDto>> {
    return this.joinRequestService.getUserRequests(req.userId, req.workspaceId, page, limit);
  }

  // ==========================================================================
  // READ — parameterised /:requestId (declared AFTER static paths)
  // ==========================================================================

  /**
   * GET /api/v1/consultations/:consultationId/requests/:requestId
   */
  @Get(':requestId')
  @Roles(...CLINICAL_ROLES)
  @Permissions('consultations:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'joinRequests_findOne',
    summary:     'Get a join request by ID',
    description: 'Returns the details of a specific join request. The requesting user must belong to the same workspace.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID',   type: String, format: 'uuid' })
  @ApiParam({ name: 'requestId',      description: 'Join request UUID',   type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Join request details', type: JoinRequestResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Join request not found' })
  async findOne(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Req() req: Request,
  ): Promise<JoinRequestResponseDto> {
    return this.joinRequestService.findOne(requestId, req.workspaceId);
  }

  // ==========================================================================
  // LIFECYCLE TRANSITIONS — sub-routes of /:requestId (after all GETs)
  // ==========================================================================

  /**
   * POST /api/v1/consultations/:consultationId/requests/:requestId/approve
   */
  @Post(':requestId/approve')
  @Roles(...APPROVER_ROLES)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'joinRequests_approve',
    summary:     'Approve a join request',
    description:
      'Transitions the join request to APPROVED and automatically adds the requester as a collaborator. ' +
      'Restricted to consultation owners and workspace admins.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiParam({ name: 'requestId',      description: 'Join request UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Join request approved', type: JoinRequestResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — approver role required' })
  @ApiResponse({ status: 404, description: 'Join request not found' })
  @ApiResponse({ status: 409, description: 'Conflict — request is not in PENDING state' })
  async approveRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Req() req: Request,
  ): Promise<JoinRequestResponseDto> {
    return this.joinRequestService.approveRequest(requestId, req.userId, req.workspaceId);
  }

  /**
   * POST /api/v1/consultations/:consultationId/requests/:requestId/reject
   */
  @Post(':requestId/reject')
  @Roles(...APPROVER_ROLES)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'joinRequests_reject',
    summary:     'Reject a join request',
    description:
      'Transitions the join request to REJECTED. The requester is not added as a collaborator. ' +
      'Restricted to consultation owners and workspace admins.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiParam({ name: 'requestId',      description: 'Join request UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Join request rejected', type: JoinRequestResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — approver role required' })
  @ApiResponse({ status: 404, description: 'Join request not found' })
  @ApiResponse({ status: 409, description: 'Conflict — request is not in PENDING state' })
  async rejectRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Req() req: Request,
  ): Promise<JoinRequestResponseDto> {
    return this.joinRequestService.rejectRequest(requestId, req.userId, req.workspaceId);
  }

  /**
   * POST /api/v1/consultations/:consultationId/requests/:requestId/cancel
   */
  @Post(':requestId/cancel')
  @Roles(...CLINICAL_ROLES)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'joinRequests_cancel',
    summary:     'Cancel a pending join request',
    description:
      'Withdraws a PENDING join request. Only the original requester may cancel their own request.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiParam({ name: 'requestId',      description: 'Join request UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Join request cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — only the requester may cancel' })
  @ApiResponse({ status: 404, description: 'Join request not found' })
  @ApiResponse({ status: 409, description: 'Conflict — request is not in PENDING state' })
  async cancelRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.joinRequestService.cancelRequest(requestId, req.userId, req.workspaceId);
  }
}
