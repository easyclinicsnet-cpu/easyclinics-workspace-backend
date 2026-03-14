/**
 * Care Notes Controller — v1
 *
 * Core CRUD layer for clinical notes with encryption, versioning, sharing,
 * publish/archive lifecycle, and paginated audit-log access.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100 % through DTOs (ValidationPipe enforces)        │
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/care-notes                        │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1):
 *   POST   /care-notes                                        — create note
 *   GET    /care-notes                                        — paginated list
 *   GET    /care-notes/consultation/:consultationId           — by consultation
 *   GET    /care-notes/:id                                    — single note
 *   PATCH  /care-notes/:id                                    — update note
 *   PATCH  /care-notes/:id/share                             — share note
 *   PATCH  /care-notes/:id/publish                           — publish note
 *   PATCH  /care-notes/:id/archive                           — archive note
 *   GET    /care-notes/:id/versions                          — version history
 *   PATCH  /care-notes/:id/versions/:versionNumber/restore   — restore version
 *   GET    /care-notes/:id/audit-logs                        — note audit trail
 *   DELETE /care-notes/:id                                    — delete note
 */

import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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

// ── Domain services ───────────────────────────────────────────────────────────
import { CareNotesService }   from '../services/care-notes.service';
import { NoteVersionService } from '../services/note-version.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateCareNoteDto,
  UpdateCareNoteDto,
  CareNoteResponseDto,
  CareNoteQueryDto,
  ShareCareNoteDto,
  NoteVersionResponseDto,
  NoteVersionQueryDto,
  NoteAuditLogQueryDto,
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
  UserRole.SCHEDULER,       // schedulers read notes for printing / pre-consultation prep
];

const CLINICAL_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
];

const PUBLISH_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
];

// ---------------------------------------------------------------------------

@ApiTags('Care Notes')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(CareNoteResponseDto, CreateCareNoteDto)
@Controller({ path: 'care-notes', version: 'v1' })
export class CareNotesController {
  constructor(
    private readonly careNotesService: CareNotesService,
    private readonly noteVersionService: NoteVersionService,
  ) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post()
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'careNotes_create',
    summary:     'Create a clinical note',
    description:
      'Creates a new encrypted clinical note for a patient or consultation. ' +
      'The author is automatically granted OWNER-level permission.',
  })
  @ApiResponse({ status: 201, description: 'Note created',       type: CareNoteResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  async create(
    @Body() dto: CreateCareNoteDto,
    @Req() req: Request,
  ): Promise<CareNoteResponseDto> {
    return this.careNotesService.create(dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // READ — static / prefix-parameterised paths before /:id
  // ==========================================================================

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_findAll',
    summary:     'List care notes (paginated)',
    description: 'Returns a paginated, filterable list of clinical notes accessible to the user in this workspace.',
  })
  @ApiResponse({ status: 200, description: 'Paginated note list', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: CareNoteQueryDto,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<CareNoteResponseDto>> {
    return this.careNotesService.findAll(query, req.userId, req.workspaceId, req.user?.role);
  }

  /**
   * GET /api/v1/care-notes/consultation/:consultationId
   * Declared before /:id to prevent routing collision.
   */
  @Get('consultation/:consultationId')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_byConsultation',
    summary:     'Get care notes by consultation',
    description: 'Returns all notes linked to the specified consultation that the user has permission to access.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 20 })
  @ApiResponse({ status: 200, description: 'Consultation notes', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findByConsultation(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<CareNoteResponseDto>> {
    return this.careNotesService.findByConsultation(
      consultationId,
      req.userId,
      req.workspaceId,
      page,
      limit,
      req.user?.role,
    );
  }

  /**
   * GET /api/v1/care-notes/patient/:patientId
   * Declared before /:id to prevent routing collision.
   */
  @Get('patient/:patientId')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_byPatient',
    summary:     'Get care notes by patient',
    description: 'Returns all notes for every consultation of the specified patient that the user has permission to access.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 20 })
  @ApiResponse({ status: 200, description: 'Patient notes', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<CareNoteResponseDto>> {
    return this.careNotesService.findByPatient(
      patientId,
      req.userId,
      req.workspaceId,
      page,
      limit,
      req.user?.role,
    );
  }

  // ==========================================================================
  // READ — parameterised /:id (after all static paths)
  // ==========================================================================

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_findOne',
    summary:     'Get a care note by ID',
    description: 'Returns the decrypted content of a single clinical note. Access is enforced by note permissions.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Note details',         type: CareNoteResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — insufficient note permission' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<CareNoteResponseDto> {
    return this.careNotesService.findOne(id, req.userId, req.workspaceId, req.user?.role);
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  @Patch(':id')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_update',
    summary:     'Update a care note',
    description:
      'Partially updates a clinical note and automatically creates a version snapshot of the previous state. ' +
      'Requires WRITE-level note permission.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Note updated',        type: CareNoteResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — write permission required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCareNoteDto,
    @Req() req: Request,
  ): Promise<CareNoteResponseDto> {
    return this.careNotesService.update(id, dto, req.userId, req.workspaceId, req.user?.role);
  }

  @Patch(':id/share')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_share',
    summary:     'Share a care note',
    description:
      'Grants specified users access to this clinical note at the requested permission level. ' +
      'Requires SHARE-level note permission.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Note shared — permissions returned' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — share permission required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async shareNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShareCareNoteDto,
    @Req() req: Request,
  ) {
    return this.careNotesService.shareNote(id, dto, req.userId, req.workspaceId, req.user?.role);
  }

  @Patch(':id/publish')
  @Roles(...PUBLISH_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_publish',
    summary:     'Publish a care note',
    description:
      'Transitions a DRAFT note to PUBLISHED, making it read-only. ' +
      'AI-generated notes must be approved before publishing. ' +
      'Requires OWNER-level note permission.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Note published',       type: CareNoteResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner permission required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  @ApiResponse({ status: 409, description: 'Conflict — note is not in a publishable state' })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<CareNoteResponseDto> {
    return this.careNotesService.publish(id, req.userId, req.workspaceId, req.user?.role);
  }

  @Patch(':id/archive')
  @Roles(...PUBLISH_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_archive',
    summary:     'Archive a care note',
    description:
      'Transitions a note to ARCHIVED status. Archived notes remain readable but cannot be edited. ' +
      'Requires OWNER-level note permission.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Note archived',        type: CareNoteResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner permission required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<CareNoteResponseDto> {
    return this.careNotesService.archive(id, req.userId, req.workspaceId, req.user?.role);
  }

  // ==========================================================================
  // VERSIONS (sub-routes of /:id)
  // ==========================================================================

  @Get(':id/versions')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_versions',
    summary:     'Get version history of a note',
    description: 'Returns a paginated version history with decrypted content snapshots for each revision.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 20 })
  @ApiResponse({ status: 200, description: 'Paginated version history', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — read permission required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async getNoteVersions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<NoteVersionResponseDto>> {
    return this.noteVersionService.findByNote(id, req.userId, req.workspaceId, page, limit, req.user?.role);
  }

  @Patch(':id/versions/:versionNumber/restore')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_restoreVersion',
    summary:     'Restore a previous version',
    description:
      'Restores a specific version of a care note and creates a new version snapshot of the current state. ' +
      'Requires WRITE-level note permission.',
  })
  @ApiParam({ name: 'id',            description: 'Care note UUID',      type: String, format: 'uuid' })
  @ApiParam({ name: 'versionNumber', description: 'Version number (≥1)', type: Number })
  @ApiResponse({ status: 200, description: 'Version restored',    type: CareNoteResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — write permission required' })
  @ApiResponse({ status: 404, description: 'Note or version not found' })
  async restoreNoteVersion(
    @Param('id',            ParseUUIDPipe) id: string,
    @Param('versionNumber', ParseIntPipe)  versionNumber: number,
    @Req() req: Request,
  ): Promise<CareNoteResponseDto> {
    return this.careNotesService.restoreVersion(id, versionNumber, req.userId, req.workspaceId, req.user?.role);
  }

  // ==========================================================================
  // AUDIT LOGS (sub-route of /:id)
  // ==========================================================================

  @Get(':id/audit-logs')
  @Roles(...PUBLISH_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'careNotes_auditLogs',
    summary:     'Get audit logs for a note',
    description:
      'Returns paginated audit logs showing all changes, shares, and lifecycle events for this note. ' +
      'Restricted to note owners and admins for HIPAA compliance.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 20 })
  @ApiResponse({ status: 200, description: 'Paginated audit logs' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — owner or admin required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async getNoteAuditLogs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: Request,
  ) {
    return this.careNotesService.getNoteAuditLogs(id, req.userId, req.workspaceId, page, limit);
  }

  // ==========================================================================
  // DELETE
  // ==========================================================================

  @Delete(':id')
  @Roles(...PUBLISH_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'careNotes_remove',
    summary:     'Delete a care note',
    description: 'Soft-deletes a clinical note. Requires DELETE-level note permission.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Note deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — delete permission required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.careNotesService.remove(id, req.userId, req.workspaceId, req.user?.role);
  }
}
