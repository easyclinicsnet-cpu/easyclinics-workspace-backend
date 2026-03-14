/**
 * Letters Controller — v1
 *
 * Manages referral letters and sick notes for a patient.
 * Covers the full lifecycle: create (directly or AI-generated), update content,
 * regenerate, issue, send (referrals), extend / cancel (sick notes), and listing.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100 % through DTOs (ValidationPipe enforces)        │
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/patients/:patientId/letters       │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/patients/:patientId/letters):
 *   GET    /health                                          — service health check
 *   GET    /referral                                        — list referral letters for patient
 *   GET    /sick-note                                       — list sick notes for patient
 *   POST   /referral                                        — create referral letter
 *   POST   /sick-note                                       — create sick note
 *   POST   /referral/generate                               — AI-generate referral letter
 *   POST   /sick-note/generate                              — AI-generate sick note
 *   GET    /consultation/:consultationId/referral           — referrals by consultation
 *   GET    /consultation/:consultationId/sick-note          — sick notes by consultation
 *   GET    /consultation/:consultationId/all                — all letters by consultation
 *   GET    /consultation/:consultationId/has-letters        — check if consultation has letters
 *   PATCH  /referral/:letterId/content                      — update referral letter content
 *   PATCH  /sick-note/:noteId/content                       — update sick note content
 *   POST   /referral/:letterId/regenerate                   — regenerate referral letter
 *   POST   /sick-note/:noteId/regenerate                    — regenerate sick note
 *   PATCH  /referral/:letterId/issue                        — issue referral letter
 *   PATCH  /sick-note/:noteId/issue                         — issue sick note
 *   PATCH  /referral/:letterId/send                         — send referral letter
 *   POST   /sick-note/:noteId/extend                        — extend sick note
 *   PATCH  /sick-note/:noteId/cancel                        — cancel sick note
 *   GET    /referral/:letterId                              — get referral letter by ID
 *   GET    /sick-note/:noteId                               — get sick note by ID
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

// ── Domain service ────────────────────────────────────────────────────────────
import { LetterGenerationService } from '../services/letter-generation.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateReferralLetterDto,
  GenerateReferralLetterDto,
  UpdateReferralLetterDto,
  ReferralLetterResponseDto,
  CreateSickNoteDto,
  GenerateSickNoteDto,
  UpdateSickNoteDto,
  ExtendSickNoteDto,
  SickNoteResponseDto,
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

const CLINICAL_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
];

/** Roles permitted to issue, send, extend or cancel letters (authoritative actions). */
const ISSUE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
];

// ---------------------------------------------------------------------------

@ApiTags('Letters')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(
  ReferralLetterResponseDto,
  SickNoteResponseDto,
  CreateReferralLetterDto,
  CreateSickNoteDto,
)
@Controller({ path: 'patients/:patientId/letters', version: 'v1' })
export class LettersController {
  constructor(private readonly letterService: LetterGenerationService) {}

  // ==========================================================================
  // HEALTH — declared first (static literal, no collision risk)
  // ==========================================================================

  @Get('health')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_health',
    summary:     'Letter service health check',
    description: 'Returns the operational status of the letter generation service (AI providers, storage, etc.).',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Service health status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async healthCheck(): Promise<any> {
    return this.letterService.healthCheck();
  }

  // ==========================================================================
  // LIST — static 1-segment paths declared before /referral/:id, /sick-note/:id
  // ==========================================================================

  @Get('referral')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_listReferrals',
    summary:     'List referral letters for a patient',
    description: 'Returns a paginated list of referral letters associated with the specified patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Referral letter list', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async listReferralLetters(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<ReferralLetterResponseDto>> {
    return this.letterService.getPatientReferrals(patientId, req.workspaceId, { page, limit });
  }

  @Get('sick-note')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_listSickNotes',
    summary:     'List sick notes for a patient',
    description: 'Returns a paginated list of sick notes associated with the specified patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Sick note list', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async listSickNotes(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<SickNoteResponseDto>> {
    return this.letterService.getPatientSickNotes(patientId, req.workspaceId, { page, limit });
  }

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post('referral')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'letters_createReferral',
    summary:     'Create a referral letter',
    description: 'Creates a new referral letter for the patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Referral letter created', type: ReferralLetterResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  async createReferralLetter(
    @Body() dto: CreateReferralLetterDto,
    @Req() req: Request,
  ): Promise<ReferralLetterResponseDto> {
    return this.letterService.createReferralLetter(dto, req.userId, req.workspaceId);
  }

  @Post('sick-note')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'letters_createSickNote',
    summary:     'Create a sick note',
    description: 'Creates a new sick note for the patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Sick note created', type: SickNoteResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical role required' })
  async createSickNote(
    @Body() dto: CreateSickNoteDto,
    @Req() req: Request,
  ): Promise<SickNoteResponseDto> {
    return this.letterService.createSickNote(dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // AI GENERATE — /referral/generate and /sick-note/generate
  // Declared BEFORE /referral/:letterId and /sick-note/:noteId to prevent
  // the router treating "generate" as a UUID parameter.
  // ==========================================================================

  @Post('referral/generate')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'letters_generateReferral',
    summary:     'AI-generate a referral letter',
    description: 'Uses AI to generate the content of a new referral letter for the patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Referral letter generated', type: ReferralLetterResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async generateReferralLetter(
    @Body() dto: GenerateReferralLetterDto,
    @Req() req: Request,
  ): Promise<ReferralLetterResponseDto> {
    return this.letterService.generateReferralLetter(dto, req.userId, req.workspaceId);
  }

  @Post('sick-note/generate')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'letters_generateSickNote',
    summary:     'AI-generate a sick note',
    description: 'Uses AI to generate the content of a new sick note for the patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Sick note generated', type: SickNoteResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async generateSickNote(
    @Body() dto: GenerateSickNoteDto,
    @Req() req: Request,
  ): Promise<SickNoteResponseDto> {
    return this.letterService.generateSickNote(dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // BY CONSULTATION — /consultation/:consultationId/...
  // All four routes share the same prefix and must be grouped together,
  // declared BEFORE the parameterised /referral/:id and /sick-note/:id routes.
  // ==========================================================================

  @Get('consultation/:consultationId/referral')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_referralsByConsultation',
    summary:     'Get referral letters by consultation',
    description: 'Returns a paginated list of referral letters linked to the specified consultation.',
  })
  @ApiParam({ name: 'patientId',      description: 'Patient UUID',     type: String, format: 'uuid' })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Referral letters by consultation', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getReferralsByConsultation(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<ReferralLetterResponseDto>> {
    return this.letterService.getReferralLettersByConsultation(consultationId, req.workspaceId, { page, limit });
  }

  @Get('consultation/:consultationId/sick-note')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_sickNotesByConsultation',
    summary:     'Get sick notes by consultation',
    description: 'Returns a paginated list of sick notes linked to the specified consultation.',
  })
  @ApiParam({ name: 'patientId',      description: 'Patient UUID',     type: String, format: 'uuid' })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Sick notes by consultation', type: PaginatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getSickNotesByConsultation(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedResponseDto<SickNoteResponseDto>> {
    return this.letterService.getSickNotesByConsultation(consultationId, req.workspaceId, { page, limit });
  }

  @Get('consultation/:consultationId/all')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_allByConsultation',
    summary:     'Get all letters by consultation',
    description: 'Returns all referral letters and sick notes linked to the specified consultation.',
  })
  @ApiParam({ name: 'patientId',      description: 'Patient UUID',     type: String, format: 'uuid' })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'All letters by consultation' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getAllByConsultation(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<any> {
    return this.letterService.getAllLettersByConsultation(consultationId, req.workspaceId, { page, limit });
  }

  @Get('consultation/:consultationId/has-letters')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_hasLetters',
    summary:     'Check if a consultation has letters',
    description: 'Returns a boolean flag indicating whether the consultation has any associated letters.',
  })
  @ApiParam({ name: 'patientId',      description: 'Patient UUID',     type: String, format: 'uuid' })
  @ApiParam({ name: 'consultationId', description: 'Consultation UUID', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Letter presence check result',
    schema: { type: 'object', properties: { hasLetters: { type: 'boolean' } } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async checkConsultationHasLetters(
    @Param('consultationId', ParseUUIDPipe) consultationId: string,
    @Req() req: Request,
  ): Promise<{ hasLetters: boolean }> {
    const hasLetters = await this.letterService.consultationHasLetters(consultationId, req.workspaceId);
    return { hasLetters };
  }

  // ==========================================================================
  // UPDATE CONTENT — /referral/:letterId/content and /sick-note/:noteId/content
  // Sub-routes with literal suffixes must precede plain /:letterId, /:noteId GETs.
  // ==========================================================================

  @Patch('referral/:letterId/content')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_updateReferralContent',
    summary:     'Update referral letter content',
    description: 'Updates the editable content fields of a referral letter.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',         type: String, format: 'uuid' })
  @ApiParam({ name: 'letterId',  description: 'Referral letter UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Referral letter updated', type: ReferralLetterResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Referral letter not found' })
  async updateReferralContent(
    @Param('letterId', ParseUUIDPipe) letterId: string,
    @Body() dto: UpdateReferralLetterDto,
    @Req() req: Request,
  ): Promise<ReferralLetterResponseDto> {
    return this.letterService.updateReferralLetterContent(letterId, dto, req.userId, req.workspaceId);
  }

  @Patch('sick-note/:noteId/content')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_updateSickNoteContent',
    summary:     'Update sick note content',
    description: 'Updates the editable content fields of a sick note.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',   type: String, format: 'uuid' })
  @ApiParam({ name: 'noteId',    description: 'Sick note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Sick note updated', type: SickNoteResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Sick note not found' })
  async updateSickNoteContent(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateSickNoteDto,
    @Req() req: Request,
  ): Promise<SickNoteResponseDto> {
    return this.letterService.updateSickNoteContent(noteId, dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // REGENERATE — POST /referral/:letterId/regenerate and /sick-note/:noteId/regenerate
  // ==========================================================================

  @Post('referral/:letterId/regenerate')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_regenerateReferral',
    summary:     'Regenerate referral letter content',
    description: 'Triggers AI re-generation of the referral letter content.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',         type: String, format: 'uuid' })
  @ApiParam({ name: 'letterId',  description: 'Referral letter UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Referral letter regenerated', type: ReferralLetterResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Referral letter not found' })
  async regenerateReferralContent(
    @Param('letterId', ParseUUIDPipe) letterId: string,
    @Body() dto: Partial<UpdateReferralLetterDto>,
    @Req() req: Request,
  ): Promise<ReferralLetterResponseDto> {
    return this.letterService.regenerateReferralLetterContent(letterId, dto, req.userId, req.workspaceId);
  }

  @Post('sick-note/:noteId/regenerate')
  @Roles(...CLINICAL_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_regenerateSickNote',
    summary:     'Regenerate sick note content',
    description: 'Triggers AI re-generation of the sick note content.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',   type: String, format: 'uuid' })
  @ApiParam({ name: 'noteId',    description: 'Sick note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Sick note regenerated', type: SickNoteResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Sick note not found' })
  async regenerateSickNoteContent(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: Partial<UpdateSickNoteDto>,
    @Req() req: Request,
  ): Promise<SickNoteResponseDto> {
    return this.letterService.regenerateSickNoteContent(noteId, dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // ISSUE — PATCH /referral/:letterId/issue and /sick-note/:noteId/issue
  // ==========================================================================

  @Patch('referral/:letterId/issue')
  @Roles(...ISSUE_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_issueReferral',
    summary:     'Issue a referral letter',
    description: 'Transitions the referral letter to ISSUED status, making it an official document.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',         type: String, format: 'uuid' })
  @ApiParam({ name: 'letterId',  description: 'Referral letter UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Referral letter issued', type: ReferralLetterResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — doctor or admin required' })
  @ApiResponse({ status: 404, description: 'Referral letter not found' })
  @ApiResponse({ status: 409, description: 'Conflict — letter is not in an issuable state' })
  async issueReferralLetter(
    @Param('letterId', ParseUUIDPipe) letterId: string,
    @Req() req: Request,
  ): Promise<ReferralLetterResponseDto> {
    return this.letterService.issueReferralLetter(letterId, req.userId, req.workspaceId);
  }

  @Patch('sick-note/:noteId/issue')
  @Roles(...ISSUE_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_issueSickNote',
    summary:     'Issue a sick note',
    description: 'Transitions the sick note to ISSUED status, making it an official document.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',   type: String, format: 'uuid' })
  @ApiParam({ name: 'noteId',    description: 'Sick note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Sick note issued', type: SickNoteResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — doctor or admin required' })
  @ApiResponse({ status: 404, description: 'Sick note not found' })
  @ApiResponse({ status: 409, description: 'Conflict — note is not in an issuable state' })
  async issueSickNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: Request,
  ): Promise<SickNoteResponseDto> {
    return this.letterService.issueSickNote(noteId, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // SEND — PATCH /referral/:letterId/send
  // ==========================================================================

  @Patch('referral/:letterId/send')
  @Roles(...ISSUE_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_sendReferral',
    summary:     'Send a referral letter',
    description: 'Marks the referral letter as SENT to the recipient. Requires prior issuance.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',         type: String, format: 'uuid' })
  @ApiParam({ name: 'letterId',  description: 'Referral letter UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Referral letter sent', type: ReferralLetterResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — doctor or admin required' })
  @ApiResponse({ status: 404, description: 'Referral letter not found' })
  @ApiResponse({ status: 409, description: 'Conflict — letter has not been issued yet' })
  async sendReferralLetter(
    @Param('letterId', ParseUUIDPipe) letterId: string,
    @Req() req: Request,
  ): Promise<ReferralLetterResponseDto> {
    return this.letterService.sendReferralLetter(letterId, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // EXTEND / CANCEL — sick note lifecycle transitions
  // ==========================================================================

  @Post('sick-note/:noteId/extend')
  @Roles(...ISSUE_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_extendSickNote',
    summary:     'Extend a sick note',
    description: 'Extends the validity period of an issued sick note.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',   type: String, format: 'uuid' })
  @ApiParam({ name: 'noteId',    description: 'Sick note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Sick note extended', type: SickNoteResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — doctor or admin required' })
  @ApiResponse({ status: 404, description: 'Sick note not found' })
  async extendSickNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: ExtendSickNoteDto,
    @Req() req: Request,
  ): Promise<SickNoteResponseDto> {
    return this.letterService.extendSickNote({ ...dto, noteId } as ExtendSickNoteDto, req.userId, req.workspaceId);
  }

  @Patch('sick-note/:noteId/cancel')
  @Roles(...ISSUE_ROLES)
  @Permissions('care-notes:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_cancelSickNote',
    summary:     'Cancel a sick note',
    description: 'Transitions the sick note to CANCELLED status. An optional cancellation reason may be provided.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',   type: String, format: 'uuid' })
  @ApiParam({ name: 'noteId',    description: 'Sick note UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'reason', required: false, type: String, description: 'Optional cancellation reason' })
  @ApiResponse({ status: 200, description: 'Sick note cancelled', type: SickNoteResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — doctor or admin required' })
  @ApiResponse({ status: 404, description: 'Sick note not found' })
  @ApiResponse({ status: 409, description: 'Conflict — sick note is already cancelled' })
  async cancelSickNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Query('reason') reason: string | undefined,
    @Req() req: Request,
  ): Promise<SickNoteResponseDto> {
    return this.letterService.cancelSickNote(noteId, req.userId, req.workspaceId, reason);
  }

  // ==========================================================================
  // GET BY ID — /referral/:letterId and /sick-note/:noteId
  // Declared LAST within each sub-tree so that parameterised catch-alls do not
  // shadow the action sub-routes declared above (regenerate, issue, send, etc.).
  // ==========================================================================

  @Get('referral/:letterId')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_getReferral',
    summary:     'Get a referral letter by ID',
    description: 'Returns the full details of a single referral letter.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',         type: String, format: 'uuid' })
  @ApiParam({ name: 'letterId',  description: 'Referral letter UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Referral letter details', type: ReferralLetterResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Referral letter not found' })
  async getReferralById(
    @Param('letterId', ParseUUIDPipe) letterId: string,
    @Req() req: Request,
  ): Promise<ReferralLetterResponseDto> {
    return this.letterService.getReferralLetterById(letterId, req.workspaceId);
  }

  @Get('sick-note/:noteId')
  @Roles(...VIEWER_ROLES)
  @Permissions('care-notes:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'letters_getSickNote',
    summary:     'Get a sick note by ID',
    description: 'Returns the full details of a single sick note.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID',   type: String, format: 'uuid' })
  @ApiParam({ name: 'noteId',    description: 'Sick note UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Sick note details', type: SickNoteResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Sick note not found' })
  async getSickNoteById(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: Request,
  ): Promise<SickNoteResponseDto> {
    return this.letterService.getSickNoteById(noteId, req.workspaceId);
  }
}
