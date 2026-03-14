/**
 * Patient Insurance Controller — v1
 *
 * Endpoints for enrolling patients in insurance schemes and managing
 * their coverage records (verification, status updates, etc.).
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/insurance/patient                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/insurance/patient):
 *   POST   /                           — enrol patient in insurance
 *   GET    /                           — list (paginated, filtered)
 *   GET    /by-patient/:patientId      — get by patient UUID (one-to-one)
 *   POST   /:id/verify                 — mark as verified
 *   PATCH  /:id                        — partial update
 *   DELETE /:id                        — soft-delete
 *   GET    /:id                        — get by UUID (LAST)
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

import { WorkspaceJwtGuard } from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }        from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }  from '../../../common/security/auth/permissions.guard';
import { Roles, Permissions } from '../../../common/security/auth/decorators';
import { UserRole } from '../../../common/enums';

import { PatientInsuranceService } from '../services/patient-insurance.service';
import {
  CreatePatientInsuranceDto,
  UpdatePatientInsuranceDto,
  QueryPatientInsuranceDto,
  VerifyPatientInsuranceDto,
  PatientInsuranceResponseDto,
} from '../dtos';
import { IPaginatedResult } from '../interfaces';

const VIEWER_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.BILLING_STAFF,
  UserRole.PHARMACIST,
  UserRole.THERAPIST,
  UserRole.SCHEDULER,
];

const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.BILLING_STAFF,
  UserRole.MEDICAL_ASSISTANT,
];

const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
];

@ApiTags('Insurance — Patient Coverage')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'insurance/patient', version: 'v1' })
export class PatientInsuranceController {
  constructor(private readonly patientInsuranceService: PatientInsuranceService) {}

  // ==========================================================================
  // CREATE (Enrolment)
  // ==========================================================================

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('insurance:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'patientInsurance_create',
    summary:     'Enrol patient in insurance',
    description: 'Creates a new patient insurance record, linking the patient to a provider and scheme.',
  })
  @ApiResponse({ status: 201, description: 'Patient insurance record created', type: PatientInsuranceResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'Patient already has an insurance record' })
  async create(
    @Body() dto: CreatePatientInsuranceDto,
    @Req()  req: Request,
  ): Promise<PatientInsuranceResponseDto> {
    return this.patientInsuranceService.create(dto, req.workspaceId);
  }

  // ==========================================================================
  // LIST
  // ==========================================================================

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patientInsurance_findAll',
    summary:     'List patient insurance records',
    description: 'Returns a paginated list of patient insurance records. Filter by patientId, providerId, etc.',
  })
  @ApiResponse({ status: 200, description: 'Paginated patient insurance list', type: [PatientInsuranceResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(
    @Query() query: QueryPatientInsuranceDto,
    @Req()   req: Request,
  ): Promise<IPaginatedResult<PatientInsuranceResponseDto>> {
    return this.patientInsuranceService.findAll(query, req.workspaceId);
  }

  // ==========================================================================
  // STATIC ROUTES — before /:id
  // ==========================================================================

  @Get('by-patient/:patientId')
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patientInsurance_byPatient',
    summary:     'Get patient insurance by patient ID',
    description: 'Returns the insurance record for a specific patient (one-to-one relationship).',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Patient insurance record', type: PatientInsuranceResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'No insurance record found for patient' })
  async findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Req()                             req:       Request,
  ): Promise<PatientInsuranceResponseDto> {
    return this.patientInsuranceService.findByPatient(patientId, req.workspaceId);
  }

  // ==========================================================================
  // VERIFY — sub-route before PATCH /:id
  // ==========================================================================

  @Post(':id/verify')
  @Roles(...WRITE_ROLES)
  @Permissions('insurance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patientInsurance_verify',
    summary:     'Verify patient insurance',
    description: 'Records that a staff member has manually verified the patient\'s insurance details with the provider.',
  })
  @ApiParam({ name: 'id', description: 'Patient insurance record UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Insurance record updated with verification details', type: PatientInsuranceResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Patient insurance record not found' })
  async verify(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     dto: VerifyPatientInsuranceDto,
    @Req()                      req: Request,
  ): Promise<PatientInsuranceResponseDto> {
    return this.patientInsuranceService.verify(id, dto, req.userId);
  }

  // ==========================================================================
  // UPDATE / DELETE
  // ==========================================================================

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('insurance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patientInsurance_update',
    summary:     'Update patient insurance record',
    description: 'Applies a partial update to a patient insurance record.',
  })
  @ApiParam({ name: 'id', description: 'Patient insurance record UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Updated patient insurance record', type: PatientInsuranceResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Patient insurance record not found' })
  async update(
    @Param('id', ParseUUIDPipe) id:  string,
    @Body()                     dto: UpdatePatientInsuranceDto,
    @Req()                      req: Request,
  ): Promise<PatientInsuranceResponseDto> {
    return this.patientInsuranceService.update(id, dto, req.userId);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @Permissions('insurance:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'patientInsurance_delete',
    summary:     'Soft-delete patient insurance record',
    description: 'Soft-deletes a patient insurance record. The record is retained for audit purposes.',
  })
  @ApiParam({ name: 'id', description: 'Patient insurance record UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Record deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Patient insurance record not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id:  string,
    @Req()                      req: Request,
  ): Promise<void> {
    return this.patientInsuranceService.softDelete(id, req.userId);
  }

  // ==========================================================================
  // GET BY ID — LAST
  // ==========================================================================

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('insurance:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patientInsurance_findById',
    summary:     'Get patient insurance record by ID',
    description: 'Returns a single patient insurance record including provider and scheme details.',
  })
  @ApiParam({ name: 'id', description: 'Patient insurance record UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Patient insurance record', type: PatientInsuranceResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Patient insurance record not found' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PatientInsuranceResponseDto> {
    return this.patientInsuranceService.findById(id);
  }
}
