/**
 * Insurance Claim Controller — v1
 *
 * Full lifecycle management for insurance claims: creation with items, workflow
 * transitions (validate → submit → approve/reject), payment recording,
 * line-item management, and reporting.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100 % through DTOs (ValidationPipe enforces)        │
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/claims                            │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/claims):
 *   POST   /                                    — create claim with items
 *   GET    /statistics/summary                  — workspace claim statistics
 *   GET    /appointment/:appointmentId/claim-data — appointment service info for claims
 *   GET    /bill/:billId/payment-split          — insurance vs patient split for bill
 *   GET    /bill/:billId                        — claims for a specific bill
 *   GET    /patient/:patientId                  — claims for a specific patient
 *   POST   /:claimId/validate                   — validate claim before submission
 *   POST   /:claimId/submit                     — submit claim to insurer
 *   POST   /:claimId/approve                    — record insurer approval
 *   POST   /:claimId/reject                     — record insurer rejection
 *   POST   /:claimId/payment                    — record insurance payment received
 *   POST   /:claimId/items/bulk                 — add multiple items to claim
 *   POST   /:claimId/items                      — add single item to claim
 *   DELETE /:claimId/items/:claimItemId         — remove item from claim
 *   GET    /:claimId                            — full claim details
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
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiQuery,
  ApiResponse,
  ApiTags,
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
import { InsuranceClaimService } from '../services/insurance-claim.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateClaimWithItemsDto,
  CreateClaimItemDto,
} from '../dto';

// ---------------------------------------------------------------------------
// Controller-scoped request body DTOs
// (These fields are not part of the barrel DTOs and are specific to workflow
//  endpoints whose new service signatures differ from the legacy DTOs.)
// ---------------------------------------------------------------------------

class ApproveClaimBodyDto {
  @ApiProperty({
    type:                 'object',
    additionalProperties: { type: 'number' },
    description:          'Map of claim item IDs to their approved amounts',
    example:              { 'item-uuid-1': 160.0, 'item-uuid-2': 120.0 },
  })
  approvedAmounts!: Record<string, number>;
}

class RejectClaimBodyDto {
  @ApiProperty({
    description: 'Reason for rejection by the insurer',
    example:     'Service not covered under current policy',
  })
  reason!: string;
}

class RecordClaimPaymentDto {
  @ApiProperty({ description: 'Amount received from insurer',    example: 280.0 })
  amount!: number;

  @ApiProperty({ description: 'Insurer payment reference number', example: 'INS-PMT-2025-001' })
  referenceNumber!: string;

  @ApiProperty({ description: 'Date payment was received',        example: '2025-06-15' })
  paymentDate!: Date;

  @ApiProperty({ description: 'Optional payment notes', required: false })
  notes?: string;
}

class BulkAddClaimItemsBodyDto {
  @ApiProperty({ type: [CreateClaimItemDto], description: 'Claim items to add in bulk' })
  items!: CreateClaimItemDto[];
}

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

const VIEWER_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.BILLING_STAFF,
];

const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.BILLING_STAFF,
  UserRole.DOCTOR,
];

/** Roles permitted to approve/reject claims and record payments. */
const ADJUDICATOR_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.BILLING_STAFF,
];

// ---------------------------------------------------------------------------

@ApiTags('Insurance Claims')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(
  CreateClaimWithItemsDto,
  CreateClaimItemDto,
  ApproveClaimBodyDto,
  RejectClaimBodyDto,
  RecordClaimPaymentDto,
  BulkAddClaimItemsBodyDto,
)
@Controller({ path: 'claims', version: 'v1' })
export class InsuranceClaimController {
  constructor(private readonly claimService: InsuranceClaimService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'claims_create',
    summary:     'Create an insurance claim with items',
    description: 'Creates a new insurance claim and its line items in a single atomic operation.',
  })
  @ApiBody({ type: CreateClaimWithItemsDto })
  @ApiResponse({ status: 201, description: 'Claim created with items' })
  @ApiResponse({ status: 400, description: 'Validation error or business rule violation' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — billing role required' })
  @ApiResponse({ status: 404, description: 'Bill or patient insurance not found' })
  @ApiResponse({ status: 409, description: 'Conflict — active claim already exists for this bill' })
  async createClaimWithItems(
    @Body() dto: CreateClaimWithItemsDto,
    @Req() req: Request,
  ) {
    return this.claimService.createClaimWithItems(dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // STATIC / PREFIXED ROUTES — declared BEFORE /:claimId
  // ==========================================================================

  @Get('statistics/summary')
  @Roles(...ADJUDICATOR_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_statistics',
    summary:     'Get claim statistics',
    description: 'Returns aggregated statistics for all insurance claims in the workspace (totals, pending count, approval rates, etc.).',
  })
  @ApiResponse({ status: 200, description: 'Claim statistics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getClaimStatistics(@Req() req: Request) {
    return this.claimService.getClaimStatistics(req.workspaceId);
  }

  @Get('appointment/:appointmentId/claim-data')
  @Roles(...WRITE_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_appointmentClaimData',
    summary:     'Get appointment claim data',
    description: 'Retrieves service times, insurance information, and diagnoses needed to prepare a claim for an appointment.',
  })
  @ApiParam({ name: 'appointmentId', description: 'Appointment UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'billId', required: true, type: String, description: 'The bill UUID to which this claim will be linked' })
  @ApiResponse({ status: 200, description: 'Appointment claim data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  async getAppointmentClaimData(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Query('billId', ParseUUIDPipe) billId: string,
    @Req() req: Request,
  ) {
    return this.claimService.getAppointmentClaimData(appointmentId, billId, req.workspaceId);
  }

  @Get('bill/:billId/payment-split')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_billPaymentSplit',
    summary:     'Get payment split for a bill',
    description: 'Calculates the breakdown of insurance responsibility vs patient responsibility for a specific bill.',
  })
  @ApiParam({ name: 'billId', description: 'Bill UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Payment split breakdown' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  async getBillPaymentSplit(
    @Param('billId', ParseUUIDPipe) billId: string,
    @Req() req: Request,
  ) {
    return this.claimService.getBillPaymentSplit(billId, req.workspaceId);
  }

  @Get('bill/:billId')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_byBill',
    summary:     'Get claims for a bill',
    description: 'Returns all insurance claims associated with the specified bill.',
  })
  @ApiParam({ name: 'billId', description: 'Bill UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Claims list for bill' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getClaimsByBill(
    @Param('billId', ParseUUIDPipe) billId: string,
    @Req() req: Request,
  ) {
    return this.claimService.getClaimsByBill(billId, req.workspaceId);
  }

  @Get('patient/:patientId')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_byPatient',
    summary:     'Get claims for a patient',
    description: 'Returns all insurance claims associated with the specified patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Claims list for patient' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getClaimsByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Req() req: Request,
  ) {
    return this.claimService.getClaimsByPatient(patientId, req.workspaceId);
  }

  // ==========================================================================
  // WORKFLOW TRANSITIONS — /:claimId/action (multi-segment, same HTTP method)
  // NB: static suffixes (/validate, /submit, …) on a parameterised first
  //     segment are safe regardless of declaration order vs plain /:claimId
  //     (different segment count), but kept here for logical grouping.
  // ==========================================================================

  @Post(':claimId/validate')
  @Roles(...WRITE_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_validate',
    summary:     'Validate claim for submission',
    description: 'Runs pre-submission validation against insurance rules. Returns isValid flag, errors, and warnings.',
  })
  @ApiParam({ name: 'claimId', description: 'Claim UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async validateClaim(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Req() req: Request,
  ) {
    return this.claimService.validateClaim(claimId, req.workspaceId);
  }

  @Post(':claimId/submit')
  @Roles(...WRITE_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_submit',
    summary:     'Submit claim to insurance provider',
    description: 'Transitions a validated claim to SUBMITTED status and sends it to the insurance company.',
  })
  @ApiParam({ name: 'claimId', description: 'Claim UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Claim submitted' })
  @ApiResponse({ status: 400, description: 'Claim failed validation or is in invalid status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async submitClaim(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Req() req: Request,
  ) {
    return this.claimService.submitClaim(claimId, req.userId, req.workspaceId);
  }

  @Post(':claimId/approve')
  @Roles(...ADJUDICATOR_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_approve',
    summary:     'Record insurance claim approval',
    description: 'Records the insurer adjudication approval with per-item approved amounts.',
  })
  @ApiParam({ name: 'claimId', description: 'Claim UUID', type: String, format: 'uuid' })
  @ApiBody({ type: ApproveClaimBodyDto })
  @ApiResponse({ status: 200, description: 'Claim approved' })
  @ApiResponse({ status: 400, description: 'Invalid status or validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — adjudicator role required' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async approveClaim(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: ApproveClaimBodyDto,
    @Req() req: Request,
  ) {
    return this.claimService.approveClaim(
      claimId,
      body.approvedAmounts,
      req.userId,
      req.workspaceId,
    );
  }

  @Post(':claimId/reject')
  @Roles(...ADJUDICATOR_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_reject',
    summary:     'Record insurance claim rejection',
    description: 'Records the insurer rejection with a mandatory reason.',
  })
  @ApiParam({ name: 'claimId', description: 'Claim UUID', type: String, format: 'uuid' })
  @ApiBody({ type: RejectClaimBodyDto })
  @ApiResponse({ status: 200, description: 'Claim rejected' })
  @ApiResponse({ status: 400, description: 'Invalid status' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — adjudicator role required' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async rejectClaim(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: RejectClaimBodyDto,
    @Req() req: Request,
  ) {
    return this.claimService.rejectClaim(claimId, body.reason, req.userId, req.workspaceId);
  }

  @Post(':claimId/payment')
  @Roles(...ADJUDICATOR_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_recordPayment',
    summary:     'Record insurance payment',
    description: 'Records payment received from the insurance company against an approved claim.',
  })
  @ApiParam({ name: 'claimId', description: 'Claim UUID', type: String, format: 'uuid' })
  @ApiBody({ type: RecordClaimPaymentDto })
  @ApiResponse({ status: 200, description: 'Payment recorded' })
  @ApiResponse({ status: 400, description: 'Invalid status or amount exceeds approved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — adjudicator role required' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async recordPayment(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: RecordClaimPaymentDto,
    @Req() req: Request,
  ) {
    return this.claimService.recordPayment(claimId, dto, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // CLAIM ITEM MANAGEMENT
  // /items/bulk (3 segs) declared BEFORE /items (2 segs) — same HTTP method,
  // different segment count so no collision, but explicit ordering is clearer.
  // ==========================================================================

  @Post(':claimId/items/bulk')
  @Roles(...WRITE_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'claims_addItemsBulk',
    summary:     'Add multiple items to a claim',
    description: 'Adds multiple bill items to an existing claim in a single bulk operation.',
  })
  @ApiParam({ name: 'claimId', description: 'Claim UUID', type: String, format: 'uuid' })
  @ApiBody({ type: BulkAddClaimItemsBodyDto })
  @ApiResponse({ status: 201, description: 'Items added to claim' })
  @ApiResponse({ status: 400, description: 'Invalid status, items already claimed, or validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Claim or bill items not found' })
  async addBulkClaimItems(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: BulkAddClaimItemsBodyDto,
    @Req() req: Request,
  ) {
    return this.claimService.addBulkClaimItems(
      claimId,
      { items: body.items },
      req.userId,
      req.workspaceId,
    );
  }

  @Post(':claimId/items')
  @Roles(...WRITE_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'claims_addItem',
    summary:     'Add a single item to a claim',
    description: 'Adds a single bill item to an existing claim.',
  })
  @ApiParam({ name: 'claimId', description: 'Claim UUID', type: String, format: 'uuid' })
  @ApiBody({ type: CreateClaimItemDto })
  @ApiResponse({ status: 201, description: 'Item added to claim' })
  @ApiResponse({ status: 400, description: 'Invalid status, item already claimed, or validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Claim or bill item not found' })
  async addClaimItem(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: CreateClaimItemDto,
    @Req() req: Request,
  ) {
    return this.claimService.addClaimItem(claimId, dto, req.userId, req.workspaceId);
  }

  @Delete(':claimId/items/:claimItemId')
  @Roles(...WRITE_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_removeItem',
    summary:     'Remove an item from a claim',
    description: 'Removes a claim line item. Cannot remove the last item from a claim.',
  })
  @ApiParam({ name: 'claimId',     description: 'Claim UUID',      type: String, format: 'uuid' })
  @ApiParam({ name: 'claimItemId', description: 'Claim item UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Item removed from claim' })
  @ApiResponse({ status: 400, description: 'Invalid status or cannot remove last item' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Claim or claim item not found' })
  async removeClaimItem(
    @Param('claimId',     ParseUUIDPipe) claimId:     string,
    @Param('claimItemId', ParseUUIDPipe) claimItemId: string,
    @Req() req: Request,
  ) {
    return this.claimService.removeClaimItem(claimId, claimItemId, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // GET BY ID — declared LAST (1-segment parameterised route)
  // ==========================================================================

  @Get(':claimId')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_getById',
    summary:     'Get claim by ID',
    description: 'Returns full claim details including line items, adjudication data, and payment history.',
  })
  @ApiParam({ name: 'claimId', description: 'Claim UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Claim details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async getClaimById(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Req() req: Request,
  ) {
    return this.claimService.getClaimById(claimId, req.workspaceId);
  }
}
