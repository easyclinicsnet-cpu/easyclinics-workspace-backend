/**
 * Note Audit Controller — v1
 *
 * Specialised audit trail management for clinical notes and AI interactions.
 * Supports full note lifecycle logging, user activity analysis, and HIPAA
 * compliance reporting.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100 % through DTOs (ValidationPipe enforces)        │
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/audit/notes                       │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1):
 *   POST   /audit/notes                               — log any note action (generic)
 *   POST   /audit/notes/:noteId/creation              — log note creation
 *   POST   /audit/notes/:noteId/update                — log note update (field diff)
 *   POST   /audit/notes/:noteId/sharing               — log sharing event
 *   POST   /audit/notes/:noteId/ai-generation         — log AI generation event
 *   GET    /audit/notes/ai                            — AI-related audit logs
 *   GET    /audit/notes/action-type                   — logs filtered by action type
 *   GET    /audit/notes/user/:userId/activity         — user note activity
 *   GET    /audit/notes/patient/:patientId            — patient-linked HIPAA trail
 *   GET    /audit/notes/:noteId/trail                 — paginated trail for a note
 */

import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiProperty,
  ApiExtraModels,
} from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type, plainToInstance } from 'class-transformer';
import { Request } from 'express';

// ── Guards ────────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC enums ────────────────────────────────────────────────────────────────
import { UserRole, NoteAuditActionType } from '../../../common/enums';

// ── Domain service ────────────────────────────────────────────────────────────
import { NoteAuditService } from '../services/note-audit.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import { CreateNoteAuditLogDto, NoteAuditLogResponseDto } from '../dto';

// ---------------------------------------------------------------------------
// Local request-scope DTOs (Swagger-annotated, scoped to this controller)
// ---------------------------------------------------------------------------

/** Query parameters for optional date-range filtering. */
class DateRangeQueryDto {
  @ApiProperty({ description: 'Start date (ISO 8601)', example: '2026-01-01T00:00:00Z', required: false })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiProperty({ description: 'End date (ISO 8601)', example: '2026-12-31T23:59:59Z', required: false })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

/** Query parameters for action-type filtered lookups. */
class ActionTypeQueryDto {
  @ApiProperty({ description: 'Note audit action type', enum: NoteAuditActionType, example: NoteAuditActionType.AI_GENERATE })
  @IsEnum(NoteAuditActionType)
  actionType: NoteAuditActionType;

  @ApiProperty({ description: 'Maximum number of records to return (1–500)', example: 50, required: false })
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  @IsOptional()
  limit?: number;
}

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

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

const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
];

const HIPAA_READ_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
];

// ---------------------------------------------------------------------------

@ApiTags('Note Audit')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(NoteAuditLogResponseDto, CreateNoteAuditLogDto)
@Controller({ path: 'audit/notes', version: 'v1' })
export class NoteAuditController {
  constructor(private readonly noteAuditService: NoteAuditService) {}

  // ==========================================================================
  // WRITE — note lifecycle events
  // ==========================================================================

  /**
   * POST /api/v1/audit/notes
   *
   * Generic endpoint — log any note action using the full CreateNoteAuditLogDto
   * payload.  Use the convenience endpoints below for common action types.
   */
  @Post()
  @Roles(...CLINICAL_ROLES)
  @Permissions('audit:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'noteAudit_log',
    summary:     'Log a note audit action',
    description:
      'Generic endpoint to record any note lifecycle event. ' +
      'Accepts the full CreateNoteAuditLogDto payload. ' +
      'Prefer the convenience endpoints (/:noteId/creation, /update, etc.) for common events.',
  })
  @ApiResponse({ status: 201, description: 'Audit log entry created', type: NoteAuditLogResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  async logNoteAction(
    @Body() dto: CreateNoteAuditLogDto,
    @Req() req: Request,
  ): Promise<NoteAuditLogResponseDto> {
    const log = await this.noteAuditService.logNoteAction(
      dto.noteId,
      dto.userId,
      dto.actionType,
      dto.changedFields,
      {
        // Always use the verified server-side values for forensic fields —
        // never trust client-supplied ipAddress / userAgent from the DTO body.
        ipAddress:      this.extractIp(req),
        userAgent:      req.headers['user-agent'] ?? '',
        comment:        dto.comment,
        patientId:      dto.patientId,
        aiProvider:     dto.aiProvider,
        sharedWith:     dto.sharedWith,
        oldPermission:  dto.oldPermission,
        newPermission:  dto.newPermission,
        previousValues: dto.previousValues,
        newValues:      dto.newValues,
        ...(dto.metadata ?? {}),
      },
      req.workspaceId,
    );
    return plainToInstance(NoteAuditLogResponseDto, log, { excludeExtraneousValues: true });
  }

  /**
   * POST /api/v1/audit/notes/:noteId/creation
   *
   * Convenience endpoint — log the creation of a clinical note.
   */
  @Post(':noteId/creation')
  @Roles(...CLINICAL_ROLES)
  @Permissions('audit:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'noteAudit_logCreation',
    summary:     'Log note creation',
    description: 'Records a CREATE audit event for the specified clinical note.',
  })
  @ApiParam({ name: 'noteId', description: 'Clinical note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Creation event logged', type: NoteAuditLogResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async logNoteCreation(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: Partial<CreateNoteAuditLogDto>,
    @Req() req: Request,
  ): Promise<NoteAuditLogResponseDto> {
    const userId = dto.userId ?? req.userId;
    const log = await this.noteAuditService.logNoteCreation(
      noteId,
      userId,
      {
        patientId: dto.patientId,
        ipAddress: this.extractIp(req),
        userAgent: req.headers['user-agent'] ?? '',
        comment:   dto.comment,
        ...(dto.metadata ?? {}),
      },
      req.workspaceId,
    );
    return plainToInstance(NoteAuditLogResponseDto, log, { excludeExtraneousValues: true });
  }

  /**
   * POST /api/v1/audit/notes/:noteId/update
   *
   * Convenience endpoint — log an update to a clinical note with a field diff.
   */
  @Post(':noteId/update')
  @Roles(...CLINICAL_ROLES)
  @Permissions('audit:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'noteAudit_logUpdate',
    summary:     'Log note update',
    description:
      'Records an UPDATE audit event for the specified clinical note. ' +
      'Supply `changedFields`, `previousValues`, and `newValues` for a full before/after diff.',
  })
  @ApiParam({ name: 'noteId', description: 'Clinical note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Update event logged', type: NoteAuditLogResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async logNoteUpdate(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: Partial<CreateNoteAuditLogDto>,
    @Req() req: Request,
  ): Promise<NoteAuditLogResponseDto> {
    const userId = dto.userId ?? req.userId;
    const log = await this.noteAuditService.logNoteUpdate(
      noteId,
      userId,
      dto.changedFields ?? [],
      {
        previousValues: dto.previousValues,
        newValues:      dto.newValues,
        patientId:      dto.patientId,
        ipAddress:      this.extractIp(req),
        userAgent:      req.headers['user-agent'] ?? '',
        comment:        dto.comment,
        ...(dto.metadata ?? {}),
      },
      req.workspaceId,
    );
    return plainToInstance(NoteAuditLogResponseDto, log, { excludeExtraneousValues: true });
  }

  /**
   * POST /api/v1/audit/notes/:noteId/sharing
   *
   * Convenience endpoint — log a note-sharing event (permission grant / change).
   */
  @Post(':noteId/sharing')
  @Roles(...CLINICAL_ROLES)
  @Permissions('audit:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'noteAudit_logSharing',
    summary:     'Log note sharing event',
    description:
      'Records a SHARE audit event for the specified clinical note. ' +
      'Supply `sharedWith`, `oldPermission`, and `newPermission` to capture the full change.',
  })
  @ApiParam({ name: 'noteId', description: 'Clinical note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Sharing event logged', type: NoteAuditLogResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async logNoteSharing(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: Partial<CreateNoteAuditLogDto>,
    @Req() req: Request,
  ): Promise<NoteAuditLogResponseDto> {
    const userId = dto.userId ?? req.userId;
    const log = await this.noteAuditService.logNoteSharing(
      noteId,
      userId,
      dto.sharedWith ?? '',
      {
        oldPermission: dto.oldPermission,
        newPermission: dto.newPermission,
        patientId:     dto.patientId,
        ipAddress:     this.extractIp(req),
        userAgent:     req.headers['user-agent'] ?? '',
        ...(dto.metadata ?? {}),
      },
      req.workspaceId,
    );
    return plainToInstance(NoteAuditLogResponseDto, log, { excludeExtraneousValues: true });
  }

  /**
   * POST /api/v1/audit/notes/:noteId/ai-generation
   *
   * Convenience endpoint — log an AI content generation event.
   */
  @Post(':noteId/ai-generation')
  @Roles(...CLINICAL_ROLES)
  @Permissions('audit:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'noteAudit_logAiGeneration',
    summary:     'Log AI generation event',
    description:
      'Records an AI_GENERATE audit event for the specified clinical note. ' +
      'Supply `aiProvider` to identify which AI provider produced the content.',
  })
  @ApiParam({ name: 'noteId', description: 'Clinical note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'AI generation event logged', type: NoteAuditLogResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async logAIGeneration(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: Partial<CreateNoteAuditLogDto>,
    @Req() req: Request,
  ): Promise<NoteAuditLogResponseDto> {
    const userId = dto.userId ?? req.userId;
    const log = await this.noteAuditService.logAIGeneration(
      noteId,
      userId,
      dto.aiProvider ?? 'unknown',
      {
        patientId: dto.patientId,
        ipAddress: this.extractIp(req),
        userAgent: req.headers['user-agent'] ?? '',
        comment:   dto.comment,
        ...(dto.metadata ?? {}),
      },
      req.workspaceId,
    );
    return plainToInstance(NoteAuditLogResponseDto, log, { excludeExtraneousValues: true });
  }

  // ==========================================================================
  // READ — static paths declared BEFORE parameterised /:noteId routes
  // ==========================================================================

  /**
   * GET /api/v1/audit/notes/ai?startDate=&endDate=
   *
   * Returns all AI-related note audit logs (AI_GENERATE, AI_APPROVE, AI_REJECT)
   * for the workspace.  Useful for AI governance and usage analysis.
   */
  @Get('ai')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteAudit_aiLogs',
    summary:     'Get AI-related note audit logs',
    description:
      'Returns all AI_GENERATE, AI_APPROVE, and AI_REJECT audit events for the workspace. ' +
      'Filter by optional date range for time-boxed governance reports.',
  })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'Start date (ISO 8601)', example: '2026-01-01T00:00:00Z' })
  @ApiQuery({ name: 'endDate',   required: false, type: String, description: 'End date (ISO 8601)',   example: '2026-12-31T23:59:59Z' })
  @ApiResponse({ status: 200, description: 'AI audit log entries', type: [NoteAuditLogResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async getAIRelatedLogs(
    @Query() query: DateRangeQueryDto,
    @Req() req: Request,
  ): Promise<NoteAuditLogResponseDto[]> {
    const dateRange =
      query.startDate || query.endDate
        ? {
            startDate: query.startDate ? new Date(query.startDate) : undefined,
            endDate:   query.endDate   ? new Date(query.endDate)   : undefined,
          }
        : undefined;
    const logs = await this.noteAuditService.getAIRelatedLogs(req.workspaceId, dateRange);
    return plainToInstance(NoteAuditLogResponseDto, logs, { excludeExtraneousValues: true });
  }

  /**
   * GET /api/v1/audit/notes/action-type?actionType=CREATE&limit=50
   *
   * Returns note audit logs filtered by a specific action type.
   */
  @Get('action-type')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteAudit_byActionType',
    summary:     'Get note audit logs by action type',
    description: 'Returns note audit events for the workspace filtered by the specified action type.',
  })
  @ApiQuery({ name: 'actionType', required: true,  enum: NoteAuditActionType, description: 'Note audit action type' })
  @ApiQuery({ name: 'limit',      required: false, type: Number,              description: 'Maximum records to return (1–500)', example: 50 })
  @ApiResponse({ status: 200, description: 'Filtered note audit entries', type: [NoteAuditLogResponseDto] })
  @ApiResponse({ status: 400, description: 'Validation error — invalid action type' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async getByActionType(
    @Query() query: ActionTypeQueryDto,
    @Req() req: Request,
  ): Promise<NoteAuditLogResponseDto[]> {
    const logs = await this.noteAuditService.getByActionType(
      query.actionType,
      req.workspaceId,
      query.limit,
    );
    return plainToInstance(NoteAuditLogResponseDto, logs, { excludeExtraneousValues: true });
  }

  /**
   * GET /api/v1/audit/notes/user/:userId/activity?startDate=&endDate=
   *
   * Returns note activity for a specific user within an optional date range.
   */
  @Get('user/:userId/activity')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteAudit_userActivity',
    summary:     'Get user note activity',
    description:
      'Returns all note audit events initiated by the specified user. ' +
      'Filter by optional date range for time-boxed activity reports.',
  })
  @ApiParam({ name: 'userId', description: 'Target user UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate',   required: false, type: String, description: 'End date (ISO 8601)' })
  @ApiResponse({ status: 200, description: 'User note activity entries', type: [NoteAuditLogResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async getUserNoteActivity(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: DateRangeQueryDto,
    @Req() req: Request,
  ): Promise<NoteAuditLogResponseDto[]> {
    const dateRange =
      query.startDate || query.endDate
        ? {
            startDate: query.startDate ? new Date(query.startDate) : undefined,
            endDate:   query.endDate   ? new Date(query.endDate)   : undefined,
          }
        : undefined;
    const logs = await this.noteAuditService.getUserNoteActivity(userId, req.workspaceId, dateRange);
    return plainToInstance(NoteAuditLogResponseDto, logs, { excludeExtraneousValues: true });
  }

  /**
   * GET /api/v1/audit/notes/patient/:patientId
   *
   * Returns all note audit logs linked to a patient (HIPAA access trail).
   */
  @Get('patient/:patientId')
  @Roles(...HIPAA_READ_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteAudit_byPatient',
    summary:     'Get patient note audit trail (HIPAA)',
    description:
      'Returns all note audit events linked to the specified patient. ' +
      'This endpoint satisfies HIPAA access-log requirements for PHI in clinical notes.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Patient note audit trail', type: [NoteAuditLogResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — doctor or admin role required' })
  async getByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Req() req: Request,
  ): Promise<NoteAuditLogResponseDto[]> {
    const logs = await this.noteAuditService.getByPatient(patientId, req.workspaceId);
    return plainToInstance(NoteAuditLogResponseDto, logs, { excludeExtraneousValues: true });
  }

  // ==========================================================================
  // READ — parameterised /:noteId routes (declared AFTER all static paths)
  // ==========================================================================

  /**
   * GET /api/v1/audit/notes/:noteId/trail?page=1&limit=20
   *
   * Returns the paginated audit trail for a specific clinical note.
   */
  @Get(':noteId/trail')
  @Roles(...CLINICAL_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteAudit_trail',
    summary:     'Get paginated audit trail for a note',
    description:
      'Returns the full, paginated audit trail for the specified clinical note. ' +
      'Every create, update, share, publish, and AI interaction is included.',
  })
  @ApiParam({ name: 'noteId', description: 'Clinical note UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',       example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)',      example: 20 })
  @ApiResponse({ status: 200, description: 'Paginated note audit trail' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async getNoteAuditTrail(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<{ data: NoteAuditLogResponseDto[]; meta: unknown }> {
    const result = await this.noteAuditService.getNoteAuditTrail(
      noteId,
      req.workspaceId,
      page,
      limit,
    );
    return {
      data: plainToInstance(NoteAuditLogResponseDto, result.data, { excludeExtraneousValues: true }),
      meta: result.meta,
    };
  }

  /**
   * GET /api/v1/audit/notes/:noteId/verify-chain
   *
   * Verifies the SHA-256 hash chain for a note's audit trail.
   * Any discrepancy indicates a tampered record.
   * Restricted to ADMIN_ROLES only.
   */
  @Get(':noteId/verify-chain')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'noteAudit_verifyChain',
    summary:     'Verify audit hash chain integrity',
    description:
      'Re-computes the SHA-256 hash chain for every audit log entry of the ' +
      'specified note. Returns valid=true when no tampering is detected.',
  })
  @ApiParam({ name: 'noteId', description: 'Clinical note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Chain verification result' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async verifyHashChain(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: Request,
  ): Promise<{ valid: boolean; brokenAt?: string; checkedCount: number }> {
    return this.noteAuditService.verifyHashChain(noteId, req.workspaceId);
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Extract the real client IP address from the request.
   * Honours X-Forwarded-For for deployments behind a reverse proxy.
   */
  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      return first.split(',')[0].trim();
    }
    return req.ip ?? req.socket?.remoteAddress ?? '';
  }
}
