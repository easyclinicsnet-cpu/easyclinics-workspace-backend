/**
 * Note Permissions Controller — v1
 *
 * Manages fine-grained access control for individual clinical notes.
 * Permissions gate read/write/share/delete operations per user per note.
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/care-notes/:noteId/permissions    │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map:
 *   POST   /care-notes/:noteId/permissions                          — grant permission
 *   GET    /care-notes/:noteId/permissions                          — list all permissions
 *   GET    /care-notes/:noteId/permissions/my                       — current user's level
 *   PATCH  /care-notes/:noteId/permissions/:permissionId            — update permission
 *   DELETE /care-notes/:noteId/permissions/:permissionId            — revoke permission
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
  Patch,
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
  ApiExtraModels,
} from '@nestjs/swagger';
import { Request } from 'express';

import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';
import { Roles, Permissions } from '../../../common/security/auth/decorators';
import { UserRole, PermissionLevel } from '../../../common/enums';
import { NotePermissionService } from '../services/note-permission.service';
import {
  CreateNotePermissionDto,
  UpdateNotePermissionDto,
  NotePermissionResponseDto,
  PaginatedResponseDto,
} from '../dto';

// ---------------------------------------------------------------------------

const CLINICAL_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
];

const VIEWER_ROLES = [
  ...CLINICAL_ROLES,
  UserRole.PHARMACIST,
  UserRole.BILLING_STAFF,
  UserRole.SCHEDULER,
];

// ---------------------------------------------------------------------------

@ApiTags('Note Permissions')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(NotePermissionResponseDto, CreateNotePermissionDto)
@Controller({ path: 'care-notes/:noteId/permissions', version: 'v1' })
export class NotePermissionsController {
  constructor(private readonly permissionService: NotePermissionService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post()
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'notePermissions_create',
    summary:     'Grant note permission',
    description:
      'Grants a workspace user access to the specified clinical note at the given permission level. ' +
      'Requires SHARE-level permission on the note.',
  })
  @ApiParam({ name: 'noteId', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Permission granted',   type: NotePermissionResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — share permission required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  @ApiResponse({ status: 409, description: 'Conflict — permission already exists' })
  async create(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: CreateNotePermissionDto,
    @Req() req: Request,
  ): Promise<NotePermissionResponseDto> {
    return this.permissionService.create(
      { ...dto, noteId },
      req.userId,
      req.workspaceId,
      req.user?.role,
    );
  }

  // ==========================================================================
  // READ — static path /my before parameterised /:permissionId
  // ==========================================================================

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'notePermissions_findByNote',
    summary:     'List permissions for a note',
    description: 'Returns all user permissions granted on the specified clinical note.',
  })
  @ApiParam({ name: 'noteId', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Note permissions', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async findByNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<NotePermissionResponseDto>> {
    return this.permissionService.findByNote(noteId, req.userId, req.workspaceId, 1, 20, req.user?.role);
  }

  /**
   * GET /api/v1/care-notes/:noteId/permissions/my
   * Declared BEFORE /:permissionId to prevent routing collision.
   */
  @Get('my')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'notePermissions_myLevel',
    summary:     'Get current user\'s permission level',
    description: 'Returns the permission level that the authenticated user holds on this note.',
  })
  @ApiParam({ name: 'noteId', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Current user permission level',
    schema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', format: 'uuid' },
        level:  { type: 'string', enum: Object.values(PermissionLevel), nullable: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyPermissionLevel(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: Request,
  ): Promise<{ noteId: string; level: PermissionLevel | null }> {
    const level = await this.permissionService.getUserPermissionLevel(
      noteId,
      req.userId,
      req.workspaceId,
      req.user?.role,
    );
    return { noteId, level };
  }

  // ==========================================================================
  // UPDATE / DELETE — parameterised /:permissionId routes
  // ==========================================================================

  @Patch(':permissionId')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'notePermissions_update',
    summary:     'Update a note permission',
    description: 'Updates the permission level for an existing note-user permission record.',
  })
  @ApiParam({ name: 'noteId',       description: 'Care note UUID',    type: String, format: 'uuid' })
  @ApiParam({ name: 'permissionId', description: 'Permission UUID',   type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Permission updated', type: NotePermissionResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — share permission required' })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  async update(
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @Body() dto: UpdateNotePermissionDto,
    @Req() req: Request,
  ): Promise<NotePermissionResponseDto> {
    return this.permissionService.update(permissionId, dto, req.userId, req.workspaceId, req.user?.role);
  }

  @Delete(':permissionId')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'notePermissions_remove',
    summary:     'Revoke a note permission',
    description: 'Removes access for the specified permission record. Requires SHARE-level note permission.',
  })
  @ApiParam({ name: 'noteId',       description: 'Care note UUID',  type: String, format: 'uuid' })
  @ApiParam({ name: 'permissionId', description: 'Permission UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Permission revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — share permission required' })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  async remove(
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.permissionService.remove(permissionId, req.userId, req.workspaceId, req.user?.role);
  }
}
