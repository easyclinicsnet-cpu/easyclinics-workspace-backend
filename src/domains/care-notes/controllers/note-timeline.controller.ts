/**
 * Note Timeline Controller — v1
 *
 * Manages the ordered sequence of clinical notes within a consultation.
 * Each consultation has a timeline that determines display order in the UI.
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/consultations/:id/timeline        │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map:
 *   GET    /consultations/:consultationId/timeline          — get ordered timeline
 *   PATCH  /consultations/:consultationId/timeline/reorder  — reorder a note
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiProperty,
  ApiExtraModels,
} from '@nestjs/swagger';
import { IsNumber, IsUUID, Min } from 'class-validator';
import { Request } from 'express';

import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';
import { Roles, Permissions } from '../../../common/security/auth/decorators';
import { UserRole } from '../../../common/enums';
import { NoteTimelineService } from '../services/note-timeline.service';
import { NoteTimelineResponseDto } from '../dto';

// ---------------------------------------------------------------------------
// Local request DTO
// ---------------------------------------------------------------------------

class ReorderNoteDto {
  @ApiProperty({ description: 'UUID of the note to reposition', format: 'uuid' })
  @IsUUID()
  noteId: string;

  @ApiProperty({ description: 'New 1-based sequence position within the timeline', example: 3 })
  @IsNumber()
  @Min(1)
  newSequence: number;
}

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

@ApiTags('Note Timeline')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(NoteTimelineResponseDto)
@Controller({ path: 'consultations/:consultationId/timeline', version: 'v1' })
export class NoteTimelineController {
  constructor(private readonly timelineService: NoteTimelineService) {}

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteTimeline_get',
    summary:     'Get consultation note timeline',
    description:
      'Returns the ordered list of clinical notes in the consultation timeline. ' +
      'Access is restricted to users with collaboration access to this consultation.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Ordered note timeline', type: [NoteTimelineResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Consultation not found' })
  async getTimeline(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Req() req: Request,
  ): Promise<NoteTimelineResponseDto[]> {
    return this.timelineService.findByConsultation(consultationId, req.userId, req.workspaceId);
  }

  @Patch('reorder')
  @Roles(...WRITE_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteTimeline_reorder',
    summary:     'Reorder a note in the timeline',
    description:
      'Moves the specified note to a new position in the consultation timeline. ' +
      'Requires write access to the consultation.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Timeline reordered', type: [NoteTimelineResponseDto] })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — write access required' })
  @ApiResponse({ status: 404, description: 'Consultation or note not found' })
  async reorderTimeline(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Body() dto: ReorderNoteDto,
    @Req() req: Request,
  ) {
    return this.timelineService.reorder(
      consultationId,
      dto.noteId,
      dto.newSequence,
      req.userId,
      req.workspaceId,
    );
  }
}
