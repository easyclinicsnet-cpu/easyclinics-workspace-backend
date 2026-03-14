/**
 * Note Template Controller — v1
 *
 * CRUD management for reusable clinical note templates.
 * Templates can be workspace-global, department-scoped, or user-private
 * and are used to pre-populate new care notes.
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/note-templates                    │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map:
 *   POST   /note-templates         — create template
 *   GET    /note-templates         — list templates (filtered)
 *   GET    /note-templates/:id     — single template
 *   PATCH  /note-templates/:id     — update template
 *   DELETE /note-templates/:id     — delete template
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
import { UserRole } from '../../../common/enums';
import { NoteTemplateService } from '../services/note-template.service';
import {
  CreateNoteTemplateDto,
  UpdateNoteTemplateDto,
  NoteTemplateResponseDto,
  NoteTemplateQueryDto,
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
  UserRole.SCHEDULER,
];

// ---------------------------------------------------------------------------

@ApiTags('Note Templates')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(NoteTemplateResponseDto, CreateNoteTemplateDto)
@Controller({ path: 'note-templates', version: 'v1' })
export class NoteTemplateController {
  constructor(private readonly templateService: NoteTemplateService) {}

  @Post()
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'noteTemplates_create',
    summary:     'Create a note template',
    description: 'Creates a new clinical note template. Templates can be scoped to the workspace, a department, or the creating user.',
  })
  @ApiResponse({ status: 201, description: 'Template created',   type: NoteTemplateResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  async create(
    @Body() dto: CreateNoteTemplateDto,
    @Req() req: Request,
  ): Promise<NoteTemplateResponseDto> {
    return this.templateService.create(dto, req.userId, req.workspaceId);
  }

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteTemplates_findAll',
    summary:     'List note templates',
    description:
      'Returns templates accessible to the user, filterable by type, note type, and department. ' +
      'Includes workspace-global, department-scoped, and user-private templates.',
  })
  @ApiResponse({ status: 200, description: 'Template list', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: NoteTemplateQueryDto,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<NoteTemplateResponseDto>> {
    return this.templateService.findAll(query, req.userId, req.workspaceId);
  }

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteTemplates_findOne',
    summary:     'Get a note template by ID',
    description: 'Returns the full details of a single note template.',
  })
  @ApiParam({ name: 'id', description: 'Template UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Template details', type: NoteTemplateResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<NoteTemplateResponseDto> {
    return this.templateService.findOne(id, req.userId, req.workspaceId);
  }

  @Patch(':id')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteTemplates_update',
    summary:     'Update a note template',
    description: 'Partially updates the content or metadata of an existing note template.',
  })
  @ApiParam({ name: 'id', description: 'Template UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Template updated', type: NoteTemplateResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — only the template owner may update' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteTemplateDto,
    @Req() req: Request,
  ): Promise<NoteTemplateResponseDto> {
    return this.templateService.update(id, dto, req.userId, req.workspaceId);
  }

  @Delete(':id')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'noteTemplates_remove',
    summary:     'Delete a note template',
    description: 'Permanently removes a note template. Only the template owner or workspace admins may delete.',
  })
  @ApiParam({ name: 'id', description: 'Template UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Template deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — only the owner may delete' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.templateService.remove(id, req.userId, req.workspaceId);
  }
}
