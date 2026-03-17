/**
 * AI Note Controller — v1
 *
 * Handles AI-powered clinical note generation, audio transcription pipelines,
 * and background transcription job management.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * │  Audio uploads use multipart/form-data (FileInterceptor)                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/ai-notes                         │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (static paths declared before parameterised /:id):
 *   POST   /ai-notes/transcribe                                   — transcribe audio → note
 *   POST   /ai-notes/generate                                     — generate note from text
 *   POST   /ai-notes/transcript/update-with-audio                 — append audio to transcript
 *   GET    /ai-notes/transcripts                                  — list transcripts (paginated)
 *   GET    /ai-notes/ready-for-note-generation                    — pending note generation
 *   GET    /ai-notes/failed                                       — failed transcriptions
 *   GET    /ai-notes/completed                                    — completed transcriptions
 *   GET    /ai-notes/background-processes                         — user's background jobs
 *   GET    /ai-notes/transcript/:transcriptId                     — single transcript
 *   GET    /ai-notes/transcript/:transcriptId/history             — transcript audit history
 *   DELETE /ai-notes/transcript/:transcriptId                     — delete transcript
 *   GET    /ai-notes/consultation/:consultationId/transcripts     — by consultation
 *   GET    /ai-notes/background-processes/:processId             — single background job
 *   POST   /ai-notes/background-processes/:processId/cancel      — cancel background job
 *   GET    /ai-notes/:id/sources                                  — AI sources for note
 *   PATCH  /ai-notes/:id/approve                                  — approve/reject AI note
 *   PATCH  /ai-notes/:id/regenerate                               — regenerate AI note
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiConsumes,
  ApiBody,
  ApiExtraModels,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import { mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Request } from 'express';

// ---------------------------------------------------------------------------
// Multer disk storage — writes audio uploads to storage/temp/audio/
// so that file.path is always a valid filesystem path for transcription strategies
// ---------------------------------------------------------------------------
const audioStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dest = join(process.cwd(), 'storage', 'temp', 'audio');
    mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname) || '.webm';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const imageStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dest = join(process.cwd(), 'storage', 'temp', 'images');
    mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  },
});

import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';
import { Roles, Permissions } from '../../../common/security/auth/decorators';
import { UserRole } from '../../../common/enums';
import { AiNoteService }                   from '../services/ai-note.service';
import {
  TranscribeAudioDto,
  AnalyzeImageDto,
  ApproveAiNoteDto,
  GenerateNoteFromTranscriptDto,
  RegenerateAiNoteDto,
  RecordingsTranscriptResponseDto,
  AiNoteSourceResponseDto,
  CareNoteResponseDto,
  PaginatedResponseDto,
} from '../dto';
import { TranscriptionJobService } from '../services';

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
];

const VIEWER_ROLES = [
  ...CLINICAL_ROLES,
  UserRole.SCHEDULER,
];

const DOCTOR_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
];

// ---------------------------------------------------------------------------

@ApiTags('AI Notes')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(CareNoteResponseDto, TranscribeAudioDto)
@Controller({ path: 'ai-notes', version: 'v1' })
export class AiNoteController {
  constructor(
    private readonly aiNoteService: AiNoteService,
    private readonly transcriptionJobService: TranscriptionJobService,
  ) {}

  // ==========================================================================
  // WRITE — audio upload & text generation (all have literal paths)
  // ==========================================================================

  /**
   * POST /api/v1/ai-notes/transcribe
   * Transcribes an audio recording and generates a clinical note.
   */
  @Post('transcribe')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('audioFile', { storage: audioStorage }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    operationId: 'aiNotes_transcribe',
    summary:     'Transcribe audio and generate AI note',
    description:
      'Uploads an audio recording, transcribes it, and generates a clinical note using AI. ' +
      'Returns immediately with a process ID for long recordings (background processing). ' +
      'Short recordings return the completed transcript synchronously.',
  })
  @ApiBody({ type: TranscribeAudioDto })
  @ApiResponse({ status: 201, description: 'Transcription started or completed' })
  @ApiResponse({ status: 400, description: 'Invalid audio file or DTO' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  async transcribeAudio(
    @Body() dto: TranscribeAudioDto,
    @UploadedFile() audioFile: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.aiNoteService.processAudioToNote(
      audioFile?.path,
      dto as any,
      req.userId,
      req.workspaceId,
    );
  }

  /**
   * POST /api/v1/ai-notes/analyze-image
   * Analyzes a medical image via AI vision and generates a structured transcript.
   */
  @Post('analyze-image')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('imageFile', { storage: imageStorage }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    operationId: 'aiNotes_analyzeImage',
    summary:     'Analyze image and generate AI note',
    description:
      'Uploads a medical image (lab result, prescription, handwritten note, X-ray, etc.), ' +
      'extracts text/content via AI vision, and generates a structured transcript. ' +
      'Supports JPEG, PNG, GIF, WebP. Max 20 MB.',
  })
  @ApiBody({ type: AnalyzeImageDto })
  @ApiResponse({ status: 201, description: 'Image analysis started or completed' })
  @ApiResponse({ status: 400, description: 'Invalid image file or DTO' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  async analyzeImage(
    @Body() dto: AnalyzeImageDto,
    @UploadedFile() imageFile: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.aiNoteService.processImageToNote(
      imageFile?.path,
      dto as any,
      req.userId,
      req.workspaceId,
    );
  }

  /**
   * POST /api/v1/ai-notes/transcript/merge
   * Combines two transcripts using a configurable merge strategy.
   */
  @Post('transcript/merge')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_mergeTranscripts',
    summary:     'Merge two transcripts',
    description:
      'Combines two existing transcripts using a configurable merge strategy (append, prepend, or smart AI-powered merge).',
  })
  @ApiResponse({ status: 200, description: 'Merged transcript', type: RecordingsTranscriptResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'One or both transcripts not found' })
  async mergeTranscripts(
    @Body() dto: any,
    @Req() req: Request,
  ): Promise<RecordingsTranscriptResponseDto> {
    return this.aiNoteService.mergeTranscripts(dto, req.userId, req.workspaceId);
  }

  /**
   * POST /api/v1/ai-notes/generate
   * Generates a clinical note from manual text input (no audio upload needed).
   */
  @Post('generate')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'aiNotes_generate',
    summary:     'Generate AI note from text input',
    description:
      'Creates a clinical note using AI from structured text input (e.g., a pre-existing transcript or manual entry). ' +
      'Returns the generated note in DRAFT status pending doctor approval.',
  })
  @ApiBody({ type: GenerateNoteFromTranscriptDto })
  @ApiResponse({ status: 201, description: 'AI note generated', type: CareNoteResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  async generateNote(
    @Body() dto: GenerateNoteFromTranscriptDto,
    @Req() req: Request,
  ): Promise<CareNoteResponseDto> {
    return this.aiNoteService.generateNote(dto as any, req.userId, req.workspaceId);
  }

  /**
   * POST /api/v1/ai-notes/transcript/update-with-audio
   * Appends or replaces content in an existing transcript with new audio.
   */
  @Post('transcript/update-with-audio')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('audioFile', { storage: audioStorage }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    operationId: 'aiNotes_updateTranscript',
    summary:     'Update transcript with new audio',
    description:
      'Appends or replaces content in an existing transcript using a new audio recording. ' +
      'Supports various merge strategies (append, replace, smart-merge).',
  })
  @ApiResponse({ status: 200, description: 'Transcript updated', type: RecordingsTranscriptResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid audio or DTO' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Transcript not found' })
  async updateTranscriptWithAudio(
    @Body() dto: { transcriptId?: string; aiNoteSourceId?: string; strategy?: string },
    @UploadedFile() audioFile: Express.Multer.File,
    @Req() req: Request,
  ): Promise<RecordingsTranscriptResponseDto> {
    return this.aiNoteService.updateTranscriptWithAudio(
      dto as any,
      audioFile?.path,
      req.userId,
      req.workspaceId,
    );
  }

  // ==========================================================================
  // READ — static 1-segment paths (before parameterised /:id routes)
  // ==========================================================================

  /**
   * GET /api/v1/ai-notes/transcripts
   * Returns all transcripts for the user with pagination and filtering.
   */
  @Get('transcripts')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_allTranscripts',
    summary:     'List transcripts (paginated)',
    description: 'Returns all recording transcripts accessible to the user, with filtering and sorting options.',
  })
  @ApiResponse({ status: 200, description: 'Paginated transcript list', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getAllTranscripts(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<RecordingsTranscriptResponseDto>> {
    return this.aiNoteService.getAllTranscripts(query, req.userId, req.workspaceId);
  }

  /**
   * GET /api/v1/ai-notes/ready-for-note-generation
   * Transcriptions in PENDING_NOTE_GENERATION status for the current user.
   */
  @Get('ready-for-note-generation')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_readyForGeneration',
    summary:     'Get transcriptions ready for note generation',
    description: 'Returns transcriptions with status PENDING_NOTE_GENERATION for the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'Transcriptions ready for processing' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — doctor role required' })
  async getTranscriptionsReadyForNoteGeneration(@Req() req: Request): Promise<any> {
    return this.transcriptionJobService.getDoctorTranscriptionsReadyForNoteGeneration(
      req.userId,
      req.workspaceId,
    );
  }

  /**
   * GET /api/v1/ai-notes/failed
   * Failed transcriptions for the current user.
   */
  @Get('failed')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_failed',
    summary:     'Get failed transcriptions',
    description: 'Returns transcriptions with status FAILED for the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'Failed transcriptions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getFailedTranscriptions(@Req() req: Request): Promise<any> {
    return this.transcriptionJobService.getDoctorFailedTranscriptions(
      req.userId,
      req.workspaceId,
    );
  }

  /**
   * GET /api/v1/ai-notes/completed
   * Completed transcriptions (NOTE_GENERATED) for the current user.
   */
  @Get('completed')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_completed',
    summary:     'Get completed transcriptions',
    description: 'Returns transcriptions with status NOTE_GENERATED for the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'Completed transcriptions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getCompletedTranscriptions(@Req() req: Request): Promise<any> {
    return this.transcriptionJobService.getDoctorCompletedTranscriptions(
      req.userId,
      req.workspaceId,
    );
  }

  /**
   * GET /api/v1/ai-notes/background-processes
   * All background transcription/generation jobs for the current user.
   */
  @Get('background-processes')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_backgroundProcesses',
    summary:     'Get user\'s background processes',
    description: 'Returns all background transcription/generation jobs initiated by the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'Background process list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getUserBackgroundProcesses(@Req() req: Request) {
    return this.aiNoteService.getUserBackgroundProcesses(req.userId, {}, req.workspaceId);
  }

  // ==========================================================================
  // READ — literal-prefixed paths (/transcript/:id, /consultation/:id/...)
  // ==========================================================================

  /**
   * GET /api/v1/ai-notes/transcript/:transcriptId
   */
  @Get('transcript/:transcriptId')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_getTranscript',
    summary:     'Get transcript by ID',
    description: 'Returns a single recording transcript with all its details and associated notes.',
  })
  @ApiParam({ name: 'transcriptId', description: 'Transcript UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Transcript details', type: RecordingsTranscriptResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Transcript not found' })
  async getTranscriptById(
    @Param('transcriptId', ParseUUIDPipe) transcriptId: string,
    @Req() req: Request,
  ): Promise<RecordingsTranscriptResponseDto> {
    return this.aiNoteService.getTranscriptById(transcriptId, req.userId, req.workspaceId);
  }

  /**
   * GET /api/v1/ai-notes/transcript/:transcriptId/history
   */
  @Get('transcript/:transcriptId/history')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_transcriptHistory',
    summary:     'Get transcript update history',
    description: 'Returns the audit history of modifications to the specified transcript.',
  })
  @ApiParam({ name: 'transcriptId', description: 'Transcript UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Transcript audit history' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Transcript not found' })
  async getTranscriptHistory(
    @Param('transcriptId', ParseUUIDPipe) transcriptId: string,
    @Req() req: Request,
  ) {
    return this.aiNoteService.getTranscriptHistory(transcriptId, req.userId, req.workspaceId);
  }

  /**
   * DELETE /api/v1/ai-notes/transcript/:transcriptId
   */
  @Delete('transcript/:transcriptId')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'aiNotes_deleteTranscript',
    summary:     'Delete a transcript',
    description: 'Permanently removes a recording transcript and all its associated data.',
  })
  @ApiParam({ name: 'transcriptId', description: 'Transcript UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Transcript deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Transcript not found' })
  async deleteTranscript(
    @Param('transcriptId', ParseUUIDPipe) transcriptId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.aiNoteService.deleteTranscript(transcriptId, req.userId, req.workspaceId);
  }

  /**
   * GET /api/v1/ai-notes/consultation/:consultationId/transcripts
   */
  @Get('consultation/:consultationId/transcripts')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_consultationTranscripts',
    summary:     'Get transcripts for a consultation',
    description: 'Returns all recording transcripts linked to the specified consultation.',
  })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Consultation transcripts' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getConsultationTranscripts(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Req() req: Request,
  ) {
    return this.aiNoteService.getConsultationTranscripts(consultationId, {} as any, req.userId, req.workspaceId);
  }

  /**
   * GET /api/v1/ai-notes/background-processes/:processId
   */
  @Get('background-processes/:processId')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_backgroundProcessStatus',
    summary:     'Get background process status',
    description: 'Returns the current status of a single background transcription/generation job.',
  })
  @ApiParam({ name: 'processId', description: 'Process UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Process status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Process not found' })
  async getBackgroundProcessStatus(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Req() req: Request,
  ) {
    return this.aiNoteService.getBackgroundProcessStatus(processId, req.userId, req.workspaceId);
  }

  /**
   * POST /api/v1/ai-notes/background-processes/:processId/cancel
   */
  @Post('background-processes/:processId/cancel')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'aiNotes_cancelProcess',
    summary:     'Cancel a background process',
    description: 'Cancels a pending or in-progress background transcription/generation job.',
  })
  @ApiParam({ name: 'processId', description: 'Process UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Process cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Process not found' })
  async cancelBackgroundProcess(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.aiNoteService.cancelBackgroundProcess(processId, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // READ/UPDATE — parameterised /:id routes (declared LAST to avoid collisions)
  // ==========================================================================

  /**
   * GET /api/v1/ai-notes/:id/sources
   */
  @Get(':id/sources')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_sources',
    summary:     'Get AI transcription sources for a note',
    description: 'Returns all source transcriptions used to generate an AI-powered clinical note.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'AI source transcriptions', type: [AiNoteSourceResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async getSources(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<AiNoteSourceResponseDto[]> {
    return this.aiNoteService.getAiSourcesForNote(id, req.userId, req.workspaceId);
  }

  /**
   * PATCH /api/v1/ai-notes/:id/approve
   * Approves or rejects a pending AI-generated clinical note.
   */
  @Patch(':id/approve')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_approve',
    summary:     'Approve or reject an AI-generated note',
    description:
      'Approves or rejects a pending AI note. ' +
      'On approval, the note transitions to DRAFT (editable) or PUBLISHED (with optional edits). ' +
      'On rejection, the note is discarded. Restricted to doctors and admins.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiBody({ type: ApproveAiNoteDto })
  @ApiResponse({ status: 200, description: 'AI note processed',  type: CareNoteResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — doctor role required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  @ApiResponse({ status: 409, description: 'Conflict — note is not in a pending approval state' })
  async approveNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveAiNoteDto,
    @Req() req: Request,
  ): Promise<CareNoteResponseDto> {
    return this.aiNoteService.approveAiNote(id, dto, req.userId, req.workspaceId);
  }

  /**
   * PATCH /api/v1/ai-notes/:id/regenerate
   * Regenerates an existing AI-generated note using updated clinical data.
   */
  @Patch(':id/regenerate')
  @Roles(...DOCTOR_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'aiNotes_regenerate',
    summary:     'Regenerate an AI note',
    description:
      'Regenerates an existing note using the provided source content (or falls back to the ' +
      'stored ai_note_source.sourceContent). Pass the user-edited transcript text as `content` ' +
      'so that edits made in the UI are respected.',
  })
  @ApiParam({ name: 'id', description: 'Care note UUID', type: String, format: 'uuid' })
  @ApiBody({ type: RegenerateAiNoteDto, required: false })
  @ApiResponse({ status: 200, description: 'Note regenerated',    type: CareNoteResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — doctor role required' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  async regenerateNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegenerateAiNoteDto = {},
    @Req() req: Request,
  ): Promise<CareNoteResponseDto> {
    return this.aiNoteService.regenerateNote(id, dto, req.userId, req.workspaceId);
  }
}
