/**
 * Consultation Collaboration Controller — v1
 *
 * Manages collaborator membership for a consultation session.
 * A collaborator is any workspace user granted access to a specific consultation
 * beyond the initiating doctor (nurses, specialists, medical assistants, etc.).
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100 % through DTOs (ValidationPipe enforces)        │
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/consultations/:id/collaborators   │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1):
 *   POST   /consultations/:consultationId/collaborators                      — add collaborators
 *   GET    /consultations/:consultationId/collaborators                      — list collaborators
 *   GET    /consultations/:consultationId/collaborators/check/:userId        — check membership
 *   PUT    /consultations/:consultationId/collaborators/:collaboratorId/role — update role
 *   DELETE /consultations/:consultationId/collaborators/:collaboratorId      — remove collaborator
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
  ApiExtraModels,
} from '@nestjs/swagger';
import { Request } from 'express';

// ── Guards ────────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC / domain enums ────────────────────────────────────────────────────────
import { UserRole, CollaborationRole } from '../../../common/enums';

// ── Domain service ────────────────────────────────────────────────────────────
import { ConsultationCollaborationService } from '../services/consultation-collaboration.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  AddCollaboratorDto,
  UpdateCollaboratorRoleDto,
  CollaboratorResponseDto,
  CollaboratorQueryDto,
  PaginatedResponseDto,
} from '../dto';

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
  UserRole.THERAPIST,
  UserRole.PHARMACIST,
  UserRole.BILLING_STAFF,
  UserRole.SCHEDULER,
];

const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
];

// ---------------------------------------------------------------------------

@ApiTags('Consultation Collaboration')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(CollaboratorResponseDto, AddCollaboratorDto)
@Controller({ path: 'consultations/:consultationId/collaborators', version: 'v1' })
export class ConsultationCollaborationController {
  constructor(
    private readonly collaborationService: ConsultationCollaborationService,
  ) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  /**
   * POST /api/v1/consultations/:consultationId/collaborators
   */
  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'collaboration_add',
    summary:     'Add collaborators to a consultation',
    description:
      'Grants one or more workspace users access to the specified consultation. ' +
      'Only the consultation owner or workspace admins may add collaborators.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Collaborators added',      type: [CollaboratorResponseDto] })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin required' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  @ApiResponse({ status: 409, description: 'Conflict — user is already a collaborator' })
  async addCollaborators(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Body() dto: AddCollaboratorDto,
    @Req() req: Request,
  ): Promise<CollaboratorResponseDto[]> {
    return this.collaborationService.addCollaborators(
      consultationId,
      dto,
      req.userId,
      req.workspaceId,
    );
  }

  // ==========================================================================
  // READ — static path before parameterised /:collaboratorId
  // ==========================================================================

  /**
   * GET /api/v1/consultations/:consultationId/collaborators
   */
  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('consultations:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'collaboration_list',
    summary:     'List all collaborators for a consultation',
    description: 'Returns a paginated, optionally filtered list of collaborators for the specified consultation.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Paginated collaborator list', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  async listCollaborators(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Query() query: CollaboratorQueryDto,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<CollaboratorResponseDto>> {
    return this.collaborationService.listCollaborators(consultationId, query, req.workspaceId);
  }

  /**
   * GET /api/v1/consultations/:consultationId/collaborators/check/:userId
   *
   * Declared BEFORE /:collaboratorId routes to prevent routing collision.
   */
  @Get('check/:userId')
  @Roles(...VIEWER_ROLES)
  @Permissions('consultations:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'collaboration_check',
    summary:     'Check if a user is a collaborator',
    description:
      'Returns whether the specified user has collaborator access to the consultation ' +
      'and, if so, their assigned role.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID',  type: String, format: 'uuid' })
  @ApiParam({ name: 'userId',         description: 'Target user UUID',   type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Collaboration membership status',
    schema: {
      type: 'object',
      properties: {
        isCollaborator: { type: 'boolean' },
        role: { type: 'string', enum: Object.values(CollaborationRole), nullable: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async isCollaborator(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Param('userId',         ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<{ isCollaborator: boolean; role: CollaborationRole | null }> {
    return this.collaborationService.isCollaborator(consultationId, userId, req.workspaceId);
  }

  // ==========================================================================
  // UPDATE / DELETE — parameterised /:collaboratorId routes
  // ==========================================================================

  /**
   * PUT /api/v1/consultations/:consultationId/collaborators/:collaboratorId/role
   */
  @Put(':collaboratorId/role')
  @Roles(...WRITE_ROLES)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'collaboration_updateRole',
    summary:     'Update a collaborator\'s role',
    description:
      'Replaces the collaboration role for the specified user on this consultation. ' +
      'Only the consultation owner or workspace admins may change roles.',
  })
  @ApiParam({ name: 'consultationId',  description: 'Consultation UUID',       type: String, format: 'uuid' })
  @ApiParam({ name: 'collaboratorId',  description: 'Collaborator user UUID',  type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Role updated', type: CollaboratorResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — invalid role' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin required' })
  @ApiResponse({ status: 404, description: 'Collaborator not found' })
  async updateCollaboratorRole(
    @Param('consultationId',  ParseUUIDPipe) consultationId: string,
    @Param('collaboratorId',  ParseUUIDPipe) collaboratorId: string,
    @Body() dto: UpdateCollaboratorRoleDto,
    @Req() req: Request,
  ): Promise<CollaboratorResponseDto> {
    return this.collaborationService.updateCollaboratorRole(
      consultationId,
      collaboratorId,
      dto,
      req.userId,
      req.workspaceId,
    );
  }

  /**
   * DELETE /api/v1/consultations/:consultationId/collaborators/:collaboratorId
   */
  @Delete(':collaboratorId')
  @Roles(...WRITE_ROLES)
  @Permissions('consultations:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'collaboration_remove',
    summary:     'Remove a collaborator from a consultation',
    description:
      'Revokes the specified user\'s access to this consultation. ' +
      'The consultation owner may not remove themselves.',
  })
  @ApiParam({ name: 'consultationId',  description: 'Consultation UUID',       type: String, format: 'uuid' })
  @ApiParam({ name: 'collaboratorId',  description: 'Collaborator user UUID',  type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Collaborator removed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin required' })
  @ApiResponse({ status: 404, description: 'Collaborator not found' })
  async removeCollaborator(
    @Param('consultationId',  ParseUUIDPipe) consultationId: string,
    @Param('collaboratorId',  ParseUUIDPipe) collaboratorId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.collaborationService.removeCollaborator(
      consultationId,
      collaboratorId,
      req.userId,
      req.workspaceId,
    );
  }
}
