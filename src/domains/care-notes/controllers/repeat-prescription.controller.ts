/**
 * RepeatPrescriptionController — v1
 *
 * Full lifecycle management for repeat (chronic) prescriptions.
 *
 * ┌─ Route map ─────────────────────────────────────────────────────────────────┐
 * │  GET    /repeat-prescriptions                  — list all (filterable)      │
 * │  POST   /repeat-prescriptions                  — create                     │
 * │  POST   /repeat-prescriptions/bulk             — bulk create (transactional) │
 * │  GET    /repeat-prescriptions/due              — overdue for refill          │
 * │  GET    /repeat-prescriptions/review           — requiring clinical review   │
 * │  GET    /repeat-prescriptions/expiring         — expiring soon               │
 * │  GET    /repeat-prescriptions/active           — all active (no pagination) │
 * │  GET    /repeat-prescriptions/analytics        — medication usage analytics  │
 * │  GET    /repeat-prescriptions/patient/:id      — by patient                 │
 * │  GET    /repeat-prescriptions/:id              — single record              │
 * │  PATCH  /repeat-prescriptions/:id              — update                     │
 * │  POST   /repeat-prescriptions/:id/issue        — issue a refill             │
 * │  POST   /repeat-prescriptions/:id/cancel       — cancel                     │
 * │  POST   /repeat-prescriptions/:id/hold         — put on hold                │
 * │  POST   /repeat-prescriptions/:id/reactivate   — reactivate from hold       │
 * │  DELETE /repeat-prescriptions/:id              — soft delete                │
 * │  POST   /repeat-prescriptions/:id/restore      — restore soft-deleted       │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiSecurity,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { Request } from 'express';

import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';
import { Roles }              from '../../../common/security/auth/decorators';
import { UserRole }           from '../../../common/enums';

import { RepeatPrescriptionsService } from '../services/repeat-prescriptions.service';
import {
  CreateRepeatPrescriptionDto,
  UpdateRepeatPrescriptionDto,
  IssueRepeatPrescriptionDto,
  CancelRepeatPrescriptionDto,
  RepeatPrescriptionQueryDto,
  RepeatPrescriptionResponseDto,
} from '../dto/repeat-prescription';

// ---------------------------------------------------------------------------
// Role shorthand — all clinical + admin staff can read; subset can mutate
// ---------------------------------------------------------------------------
const ALL_CLINICAL_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.PHARMACIST,
  UserRole.THERAPIST,
  UserRole.LAB_TECHNICIAN,
  UserRole.RADIOLOGY_TECHNICIAN,
  UserRole.BILLING_STAFF,
  UserRole.READ_ONLY,
  UserRole.SCHEDULER,
];

const PRESCRIBING_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.PHARMACIST,
];

// ---------------------------------------------------------------------------

@ApiTags('Repeat Prescriptions')
@ApiBearerAuth('JWT')
@ApiSecurity('WorkspaceId')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'repeat-prescriptions', version: 'v1' })
export class RepeatPrescriptionController {
  constructor(private readonly service: RepeatPrescriptionsService) {}

  // ── LIST / SEARCH ──────────────────────────────────────────────────────────

  @Get()
  @Roles(...ALL_CLINICAL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_findAll',
    summary: 'List repeat prescriptions',
    description: 'Returns a paginated list of repeat prescriptions for the workspace, with optional filters.',
  })
  @ApiResponse({ status: 200, description: 'Paginated repeat prescriptions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(
    @Query() query: RepeatPrescriptionQueryDto,
    @Req() req: Request,
  ) {
    return this.service.findAll(query, req.workspaceId);
  }

  // ── SPECIAL QUERY ROUTES (must be before /:id) ─────────────────────────────

  @Get('due')
  @Roles(...ALL_CLINICAL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_findDue',
    summary: 'List repeat prescriptions due for refill',
    description: 'Returns active repeat prescriptions whose nextDueDate is today or in the past.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated due repeat prescriptions' })
  findDue(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ) {
    return this.service.findDueForRefill(req.workspaceId, page, limit);
  }

  @Get('review')
  @Roles(...ALL_CLINICAL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_findReview',
    summary: 'List repeat prescriptions requiring review',
    description: 'Returns prescriptions marked requiresReview whose reviewDate is due.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findRequiringReview(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ) {
    return this.service.findRequiringReview(req.workspaceId, page, limit);
  }

  @Get('expiring')
  @Roles(...ALL_CLINICAL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_findExpiring',
    summary: 'List repeat prescriptions expiring soon',
    description: 'Returns active prescriptions with an endDate within the next N days.',
  })
  @ApiQuery({ name: 'days',  required: false, type: Number, description: 'Lookahead window (default 30)' })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findExpiring(
    @Query('days',  new DefaultValuePipe(30), ParseIntPipe) days: number,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ) {
    return this.service.findExpiring(req.workspaceId, days, page, limit);
  }

  @Get('active')
  @Roles(...ALL_CLINICAL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_findActive',
    summary: 'List all active repeat prescriptions (no pagination)',
    description: 'Returns all ACTIVE repeat prescriptions in the workspace without pagination.',
  })
  findActive(@Req() req: Request) {
    return this.service.findActive(req.workspaceId);
  }

  @Get('analytics')
  @Roles(...ALL_CLINICAL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_analytics',
    summary: 'Medication usage analytics',
    description: 'Returns top-N medicines by prescription count across the workspace.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default 20)' })
  getAnalytics(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: Request,
  ) {
    return this.service.getMedicationUsageAnalytics(req.workspaceId, limit);
  }

  @Get('patient/:patientId')
  @Roles(...ALL_CLINICAL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_findByPatient',
    summary: 'List repeat prescriptions for a patient',
    description: 'Returns a paginated list of all repeat prescriptions for the specified patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: Request,
  ) {
    return this.service.findByPatient(patientId, req.workspaceId, page, limit);
  }

  // ── SINGLE RECORD ──────────────────────────────────────────────────────────

  @Get(':id')
  @Roles(...ALL_CLINICAL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_findOne',
    summary: 'Get a repeat prescription by ID',
  })
  @ApiParam({ name: 'id', description: 'Repeat prescription UUID', type: String })
  @ApiResponse({ status: 200, type: RepeatPrescriptionResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.service.findOne(id, req.workspaceId);
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────

  @Post()
  @Roles(...PRESCRIBING_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'repeatPrescriptions_create',
    summary: 'Create a repeat prescription',
    description: 'Creates a new repeat (chronic) prescription for a patient.',
  })
  @ApiResponse({ status: 201, type: RepeatPrescriptionResponseDto })
  create(
    @Body() dto: CreateRepeatPrescriptionDto,
    @Req() req: Request,
  ) {
    return this.service.create(dto, req.userId, req.workspaceId);
  }

  @Post('bulk')
  @Roles(...PRESCRIBING_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'repeatPrescriptions_bulkCreate',
    summary: 'Bulk create repeat prescriptions (transactional)',
    description: 'Creates multiple repeat prescriptions atomically. All-or-nothing — any failure rolls back the entire batch.',
  })
  @ApiResponse({ status: 201, description: 'Array of created repeat prescriptions' })
  bulkCreate(
    @Body() dtos: CreateRepeatPrescriptionDto[],
    @Req() req: Request,
  ) {
    return this.service.bulkCreate(dtos, req.userId, req.workspaceId);
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────

  @Patch(':id')
  @Roles(...PRESCRIBING_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_update',
    summary: 'Update a repeat prescription',
  })
  @ApiParam({ name: 'id', description: 'Repeat prescription UUID', type: String })
  @ApiResponse({ status: 200, type: RepeatPrescriptionResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRepeatPrescriptionDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, dto, req.userId, req.workspaceId);
  }

  // ── BUSINESS OPERATIONS ────────────────────────────────────────────────────

  @Post(':id/issue')
  @Roles(...PRESCRIBING_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'repeatPrescriptions_issue',
    summary: 'Issue a refill for a repeat prescription',
    description:
      'Validates all constraints (status, maxRepeats, endDate, requiresReview) then creates a new ' +
      'Prescription record linked to the given appointment/consultation, increments repeatsIssued, and ' +
      'recalculates nextDueDate. Automatically sets status to COMPLETED when maxRepeats is reached.',
  })
  @ApiParam({ name: 'id', description: 'Repeat prescription UUID', type: String })
  @ApiResponse({ status: 201, description: 'Issued prescription + updated repeat prescription' })
  @ApiResponse({ status: 404, description: 'Repeat prescription or appointment/consultation not found' })
  @ApiResponse({ status: 409, description: 'Business rule violation (not active, max repeats, expired, requires review)' })
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueRepeatPrescriptionDto,
    @Req() req: Request,
  ) {
    return this.service.issueRepeat(id, dto, req.userId, req.workspaceId);
  }

  @Post(':id/cancel')
  @Roles(...PRESCRIBING_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_cancel',
    summary: 'Cancel a repeat prescription',
  })
  @ApiParam({ name: 'id', description: 'Repeat prescription UUID', type: String })
  @ApiResponse({ status: 200, type: RepeatPrescriptionResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelRepeatPrescriptionDto,
    @Req() req: Request,
  ) {
    return this.service.cancelRepeatPrescription(id, dto, req.userId, req.workspaceId);
  }

  @Post(':id/hold')
  @Roles(...PRESCRIBING_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_hold',
    summary: 'Put a repeat prescription on hold',
    description: 'Transitions an ACTIVE prescription to ON_HOLD status.',
  })
  @ApiParam({ name: 'id', description: 'Repeat prescription UUID', type: String })
  @ApiResponse({ status: 200, type: RepeatPrescriptionResponseDto })
  @ApiResponse({ status: 409, description: 'Prescription is not ACTIVE' })
  putOnHold(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.service.putOnHold(id, req.userId, req.workspaceId);
  }

  @Post(':id/reactivate')
  @Roles(...PRESCRIBING_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_reactivate',
    summary: 'Reactivate a held repeat prescription',
    description: 'Transitions an ON_HOLD prescription back to ACTIVE status.',
  })
  @ApiParam({ name: 'id', description: 'Repeat prescription UUID', type: String })
  @ApiResponse({ status: 200, type: RepeatPrescriptionResponseDto })
  @ApiResponse({ status: 409, description: 'Prescription is not ON_HOLD' })
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.service.reactivate(id, req.userId, req.workspaceId);
  }

  // ── SOFT DELETE / RESTORE ──────────────────────────────────────────────────

  @Delete(':id')
  @Roles(...PRESCRIBING_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'repeatPrescriptions_remove',
    summary: 'Soft-delete a repeat prescription',
    description: 'Sets deletedAt timestamp. Record is excluded from all standard queries.',
  })
  @ApiParam({ name: 'id', description: 'Repeat prescription UUID', type: String })
  @ApiResponse({ status: 204, description: 'Soft-deleted successfully' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.service.remove(id, req.userId, req.workspaceId);
  }

  @Post(':id/restore')
  @Roles(...PRESCRIBING_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'repeatPrescriptions_restore',
    summary: 'Restore a soft-deleted repeat prescription',
    description: 'Clears deletedAt so the record re-appears in standard queries.',
  })
  @ApiParam({ name: 'id', description: 'Repeat prescription UUID', type: String })
  @ApiResponse({ status: 200, type: RepeatPrescriptionResponseDto })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Prescription is not deleted' })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.service.restore(id, req.userId, req.workspaceId);
  }
}
