/**
 * TranscriptionJobController — v1
 *
 * REST endpoints for managing TranscriptionJob records (both STANDARD and
 * BACKGROUND modes).
 *
 * ┌─ Contract ──────────────────────────────────────────────────────────────────┐
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT            │
 * │  All list responses use TranscriptionItemDto (typed columns, no JSON blobs) │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map:
 *   GET    /transcription-jobs                    — list all jobs (paginated, filterable)
 *   GET    /transcription-jobs/ready              — COMPLETED + PENDING_NOTE_GENERATION
 *   GET    /transcription-jobs/failed             — FAILED jobs
 *   GET    /transcription-jobs/completed          — NOTE_GENERATED jobs
 *   GET    /transcription-jobs/:id                — full detail / status of one job
 *   GET    /transcription-jobs/:id/transcript     — load the linked RecordingsTranscript
 *   PATCH  /transcription-jobs/:id/cancel         — cancel a pending/in-progress job
 *   PATCH  /transcription-jobs/:id/retry          — retry a failed/cancelled job
 *
 * WebSocket (namespace /transcription-jobs):
 *   Client connects with JWT → auto-joins personal room
 *   Server events: transcription.progress | transcription.completed |
 *                  transcription.failed   | transcription.cancelled
 */

import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';

import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';
import { Roles, Permissions } from '../../../common/security/auth/decorators';
import { UserRole, TranscriptionStatus, TranscriptionMode } from '../../../common/enums';

import { TranscriptionJobService, type TranscriptionItemDto } from '../services/transcription-job.service';

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

/** Only prescribing/consulting roles may access transcription jobs.
 *  Nurses, medical assistants, and therapists do not initiate consultations
 *  with background audio recording, so they are intentionally excluded. */
const DOCTOR_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
];

// ---------------------------------------------------------------------------

@ApiTags('Transcription Jobs')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'transcription-jobs', version: 'v1' })
export class TranscriptionJobController {
  constructor(
    private readonly transcriptionJobService: TranscriptionJobService,
  ) {}

  // ==========================================================================
  // Static paths — must be declared BEFORE /:id to avoid route shadowing
  // ==========================================================================

  /**
   * GET /api/v1/transcription-jobs
   *
   * List all transcription jobs for the authenticated user.
   * Supports optional filters: status, consultationId, limit, offset.
   */
  @Get()
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'transcriptionJobs_list',
    summary: 'List transcription jobs',
    description:
      'Returns all transcription jobs (STANDARD and BACKGROUND) for the ' +
      'authenticated user. Supports filtering by status and consultationId.',
  })
  @ApiQuery({ name: 'status',         required: false, enum: TranscriptionStatus, description: 'Filter by status' })
  @ApiQuery({ name: 'mode',           required: false, enum: TranscriptionMode,   description: 'Filter by mode (STANDARD or BACKGROUND)' })
  @ApiQuery({ name: 'consultationId', required: false, type: String,              description: 'Filter by consultation UUID' })
  @ApiQuery({ name: 'limit',          required: false, type: Number,              description: 'Page size (default 10)' })
  @ApiQuery({ name: 'offset',         required: false, type: Number,              description: 'Page offset (default 0)' })
  @ApiResponse({ status: 200, description: 'Paginated list of transcription jobs' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listJobs(
    @Req() req: Request,
    @Query('status')         status?: TranscriptionStatus,
    @Query('mode')           mode?: TranscriptionMode,
    @Query('consultationId') consultationId?: string,
    @Query('limit')          limit?: number,
    @Query('offset')         offset?: number,
  ): Promise<any> {
    return this.transcriptionJobService.getUserTranscriptions(
      req.userId,
      req.workspaceId,
      {
        status,
        mode,
        consultationId,
        limit:  limit  ? Number(limit)  : undefined,
        offset: offset ? Number(offset) : undefined,
      },
    );
  }

  /**
   * GET /api/v1/transcription-jobs/ready
   *
   * Returns jobs that are ready for note generation.
   * Includes STANDARD jobs (status=COMPLETED) and BACKGROUND jobs
   * (status=PENDING_NOTE_GENERATION).
   */
  @Get('ready')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'transcriptionJobs_ready',
    summary: 'Get jobs ready for note generation',
    description:
      'Returns transcription jobs where a transcript exists and a clinical ' +
      'note can be generated. Covers STANDARD (COMPLETED) and BACKGROUND ' +
      '(PENDING_NOTE_GENERATION) modes.',
  })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (default 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default 10)' })
  @ApiResponse({ status: 200, description: 'Jobs ready for note generation' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Doctor role required' })
  async readyForNoteGeneration(
    @Req() req: Request,
    @Query('page')  page?: number,
    @Query('limit') limit?: number,
  ): Promise<any> {
    return this.transcriptionJobService.getDoctorTranscriptionsReadyForNoteGeneration(
      req.userId,
      req.workspaceId,
      page  ? Number(page)  : 1,
      limit ? Number(limit) : 10,
    );
  }

  /**
   * GET /api/v1/transcription-jobs/failed
   *
   * Returns permanently failed transcription jobs (all retries exhausted).
   */
  @Get('failed')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'transcriptionJobs_failed',
    summary: 'Get failed transcription jobs',
    description: 'Returns jobs with status FAILED for the authenticated user.',
  })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Failed transcription jobs' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async failedJobs(
    @Req() req: Request,
    @Query('page')  page?: number,
    @Query('limit') limit?: number,
  ): Promise<any> {
    return this.transcriptionJobService.getDoctorFailedTranscriptions(
      req.userId,
      req.workspaceId,
      page  ? Number(page)  : 1,
      limit ? Number(limit) : 10,
    );
  }

  /**
   * GET /api/v1/transcription-jobs/completed
   *
   * Returns jobs where a clinical note has been successfully generated.
   */
  @Get('completed')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'transcriptionJobs_completed',
    summary: 'Get completed transcription jobs (note generated)',
    description:
      'Returns jobs with status NOTE_GENERATED for the authenticated user.',
  })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Completed transcription jobs' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async completedJobs(
    @Req() req: Request,
    @Query('page')  page?: number,
    @Query('limit') limit?: number,
  ): Promise<any> {
    return this.transcriptionJobService.getDoctorCompletedTranscriptions(
      req.userId,
      req.workspaceId,
      page  ? Number(page)  : 1,
      limit ? Number(limit) : 10,
    );
  }

  // ==========================================================================
  // Parameterised paths — /:id must come AFTER all static paths
  // ==========================================================================

  /**
   * GET /api/v1/transcription-jobs/:id
   *
   * Returns the full status and all typed fields for a single job.
   * Includes progress percentage, message, provider info, error details, etc.
   */
  @Get(':id')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'transcriptionJobs_getStatus',
    summary: 'Get transcription job status',
    description:
      'Returns the current status, progress, and all metadata for a single ' +
      'transcription job. Use the WebSocket gateway for real-time updates instead ' +
      'of polling this endpoint.',
  })
  @ApiParam({ name: 'id', description: 'Transcription job UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200,  description: 'Job status and detail' })
  @ApiResponse({ status: 401,  description: 'Unauthorized' })
  @ApiResponse({ status: 403,  description: 'Forbidden — not the owning doctor' })
  @ApiResponse({ status: 404,  description: 'Job not found' })
  async getJobStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<any> {
    return this.transcriptionJobService.getTranscriptionStatus(
      id,
      req.userId,
      req.workspaceId,
    );
  }

  /**
   * GET /api/v1/transcription-jobs/:id/transcript
   *
   * Returns the linked RecordingsTranscript once the job is complete.
   * Only works for jobs in COMPLETED, PENDING_NOTE_GENERATION, or NOTE_GENERATED status.
   */
  @Get(':id/transcript')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'transcriptionJobs_getTranscript',
    summary: 'Get the completed transcript for a job',
    description:
      'Loads the RecordingsTranscript linked to this job once it has finished ' +
      'processing. Use this to retrieve the structured transcript text for note ' +
      'generation.',
  })
  @ApiParam({ name: 'id', description: 'Transcription job UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200,  description: 'Job info and full RecordingsTranscript' })
  @ApiResponse({ status: 400,  description: 'Job not yet complete' })
  @ApiResponse({ status: 401,  description: 'Unauthorized' })
  @ApiResponse({ status: 403,  description: 'Forbidden — not the owning doctor' })
  @ApiResponse({ status: 404,  description: 'Job or transcript not found' })
  async getTranscript(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<any> {
    return this.transcriptionJobService.getCompletedTranscription(
      id,
      req.userId,
      req.workspaceId,
    );
  }

  /**
   * PATCH /api/v1/transcription-jobs/:id/cancel
   *
   * Cancels a pending or in-progress transcription job.
   * Has no effect on jobs already in a terminal state.
   */
  @Patch(':id/cancel')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'transcriptionJobs_cancel',
    summary: 'Cancel a transcription job',
    description:
      'Marks a pending or in-progress job as CANCELLED. ' +
      'A WebSocket transcription.cancelled event is emitted to all subscribed clients.',
  })
  @ApiParam({ name: 'id', description: 'Transcription job UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200,  description: 'Job cancelled successfully' })
  @ApiResponse({ status: 400,  description: 'Job is already in a terminal state' })
  @ApiResponse({ status: 401,  description: 'Unauthorized' })
  @ApiResponse({ status: 403,  description: 'Forbidden — not the owning doctor' })
  @ApiResponse({ status: 404,  description: 'Job not found' })
  async cancelJob(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<{ success: boolean; message: string }> {
    return this.transcriptionJobService.cancelTranscription(
      id,
      req.userId,
      req.workspaceId,
    );
  }

  /**
   * PATCH /api/v1/transcription-jobs/:id/retry
   *
   * Retries a failed or cancelled transcription job by resetting it to
   * PENDING state. Only works if the original audio file still exists.
   */
  @Patch(':id/retry')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'transcriptionJobs_retry',
    summary: 'Retry a failed transcription job',
    description:
      'Resets a FAILED or CANCELLED transcription job back to PENDING so it can ' +
      'be reprocessed. The original audio file must still exist on disk.',
  })
  @ApiParam({ name: 'id', description: 'Transcription job UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200,  description: 'Job reset for retry' })
  @ApiResponse({ status: 400,  description: 'Job is not in a retryable state or audio file missing' })
  @ApiResponse({ status: 401,  description: 'Unauthorized' })
  @ApiResponse({ status: 403,  description: 'Forbidden — not the owning doctor' })
  @ApiResponse({ status: 404,  description: 'Job not found' })
  async retryFailedJob(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<TranscriptionItemDto> {
    return this.transcriptionJobService.retryFailedJob(
      id,
      req.workspaceId,
      req.userId,
    );
  }
}
