/**
 * Bill Controller — v1
 *
 * Full lifecycle management for patient bills: creation, retrieval, line-item
 * management, status transitions (cancel), and analytics.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100 % through DTOs (ValidationPipe enforces)        │
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT           │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/bills                             │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1/bills):
 *   GET    /analytics/summary               — bill analytics for a date range
 *   GET    /status/overdue                  — list overdue bills
 *   GET    /patient/:patientId              — bills for a patient
 *   GET    /appointment/:appointmentId      — bills for an appointment
 *   POST   /                                — create bill
 *   GET    /                                — list / search bills
 *   POST   /:billId/items                   — add line item to bill
 *   PATCH  /:billId/items/:itemId           — update line item
 *   DELETE /:billId/items/:itemId           — remove line item
 *   GET    /:id/summary                     — condensed bill summary
 *   GET    /:id/breakdown                   — payment breakdown (paid / balance)
 *   POST   /:id/cancel                      — cancel bill
 *   PATCH  /:id                             — update bill header
 *   GET    /:id                             — full bill details
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
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
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

// ── Domain service ────────────────────────────────────────────────────────────
import { BillService } from '../services/bill.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateBillDto,
  UpdateBillDto,
  BillQueryDto,
  CreateBillItemDto,
  UpdateBillItemDto,
  BillResponseDto,
  BillItemResponseDto,
} from '../dto';
import {
  PaginatedBillResponseDto,
  BillAnalyticsDto,
} from '../dto/responses/bill.dto';

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
  UserRole.PHARMACIST,
];

const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.BILLING_STAFF,
  UserRole.DOCTOR,
];

/** Roles that may cancel bills or remove items (authoritative actions). */
const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.BILLING_STAFF,
];

// ---------------------------------------------------------------------------

@ApiTags('Bills')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(BillResponseDto, BillItemResponseDto, CreateBillDto, UpdateBillDto)
@Controller({ path: 'bills', version: 'v1' })
export class BillController {
  constructor(private readonly billService: BillService) {}

  // ==========================================================================
  // ANALYTICS — /analytics/summary
  // Declared FIRST: "analytics" literal must not be consumed as /:id param
  // ==========================================================================

  @Get('analytics/summary')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_analytics',
    summary:     'Get bill analytics',
    description: 'Returns comprehensive analytics (revenue, status breakdown, top items) for bills within the given date range.',
  })
  @ApiQuery({ name: 'startDate', required: true,  type: String, description: 'Period start (ISO 8601)', example: '2025-01-01' })
  @ApiQuery({ name: 'endDate',   required: true,  type: String, description: 'Period end (ISO 8601)',   example: '2025-12-31' })
  @ApiResponse({ status: 200, description: 'Analytics data', type: BillAnalyticsDto })
  @ApiResponse({ status: 400, description: 'Invalid date format' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getBillAnalytics(
    @Query('startDate') startDate: string,
    @Query('endDate')   endDate:   string,
    @Req() req: Request,
  ): Promise<BillAnalyticsDto> {
    return this.billService.getBillAnalytics(
      new Date(startDate),
      new Date(endDate),
      req.workspaceId,
    );
  }

  // ==========================================================================
  // OVERDUE — /status/overdue
  // Declared BEFORE /:id so "status" is never matched as an ID value
  // ==========================================================================

  @Get('status/overdue')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_listOverdue',
    summary:     'List overdue bills',
    description: 'Returns all bills that are past their due date with outstanding balances.',
  })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Overdue bill list', type: PaginatedBillResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getOverdueBills(
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedBillResponseDto> {
    return this.billService.getBills(
      { status: 'OVERDUE', page, limit } as BillQueryDto,
      req.workspaceId,
    );
  }

  // ==========================================================================
  // FILTERED BY ENTITY — static-prefix routes before /:id
  // ==========================================================================

  @Get('patient/:patientId')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_byPatient',
    summary:     'Get bills for a patient',
    description: 'Returns a paginated list of all bills for the specified patient.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Patient bill list', type: PaginatedBillResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getBillsByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedBillResponseDto> {
    return this.billService.getBillsByPatient(patientId, page, limit, req.workspaceId);
  }

  @Get('appointment/:appointmentId')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_byAppointment',
    summary:     'Get bills for an appointment',
    description: 'Returns a paginated list of all bills associated with the specified appointment.',
  })
  @ApiParam({ name: 'appointmentId', description: 'Appointment UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'page',  required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiResponse({ status: 200, description: 'Appointment bill list', type: PaginatedBillResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getBillsByAppointment(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ): Promise<PaginatedBillResponseDto> {
    return this.billService.getBills(
      { appointmentId, page, limit } as BillQueryDto,
      req.workspaceId,
    );
  }

  // ==========================================================================
  // MAIN CRUD
  // ==========================================================================

  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'bills_create',
    summary:     'Create a new bill',
    description: 'Creates a new patient bill with line items. Automatically processes inventory billing for items linked to batches.',
  })
  @ApiBody({ type: CreateBillDto })
  @ApiResponse({ status: 201, description: 'Bill created',     type: BillResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error or business rule violation' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — billing role required' })
  @ApiResponse({ status: 404, description: 'Patient, appointment, discount, or tax not found' })
  async createBill(
    @Body() dto: CreateBillDto,
    @Req() req: Request,
  ): Promise<BillResponseDto> {
    return this.billService.createBill(dto, req.userId, req.workspaceId);
  }

  @Get()
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_list',
    summary:     'List / search bills',
    description: 'Returns bills with optional filters for patient, appointment, status, date range, and search term.',
  })
  @ApiQuery({ name: 'page',          required: false, type: Number, description: 'Page number (≥1)',  example: 1  })
  @ApiQuery({ name: 'limit',         required: false, type: Number, description: 'Page size (1–100)', example: 10 })
  @ApiQuery({ name: 'patientId',     required: false, type: String, description: 'Filter by patient UUID'  })
  @ApiQuery({ name: 'appointmentId', required: false, type: String, description: 'Filter by appointment UUID' })
  @ApiQuery({ name: 'status',        required: false, type: String, description: 'Filter by bill status (DRAFT | PENDING | PARTIAL | PAID | OVERDUE | CANCELLED | REFUNDED | VOIDED)' })
  @ApiQuery({ name: 'startDate',     required: false, type: String, description: 'Date range start (ISO 8601)' })
  @ApiQuery({ name: 'endDate',       required: false, type: String, description: 'Date range end (ISO 8601)'   })
  @ApiQuery({ name: 'search',        required: false, type: String, description: 'Search by bill number'       })
  @ApiResponse({ status: 200, description: 'Paginated bill list', type: PaginatedBillResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getBills(
    @Query() query: BillQueryDto,
    @Req() req: Request,
  ): Promise<PaginatedBillResponseDto> {
    return this.billService.getBills(query, req.workspaceId);
  }

  // ==========================================================================
  // BILL ITEM MANAGEMENT — /:billId/items and /:billId/items/:itemId
  // Nested multi-segment paths — declared after 2-segment /patient|appointment
  // routes but before 1-segment /:id routes
  // ==========================================================================

  @Post(':billId/items')
  @Roles(...WRITE_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'bills_addItem',
    summary:     'Add a line item to a bill',
    description: 'Adds a new item to an existing bill. For inventory items, processes billing through the inventory system. Bill must be in DRAFT or PENDING status.',
  })
  @ApiParam({ name: 'billId', description: 'Bill UUID', type: String, format: 'uuid' })
  @ApiBody({ type: CreateBillItemDto })
  @ApiResponse({ status: 201, description: 'Item added',          type: BillResponseDto })
  @ApiResponse({ status: 400, description: 'Bill not editable or item validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  async addBillItem(
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body() dto: CreateBillItemDto,
    @Req() req: Request,
  ): Promise<BillResponseDto> {
    return this.billService.addBillItem(billId, dto, req.userId, req.workspaceId);
  }

  @Patch(':billId/items/:itemId')
  @Roles(...WRITE_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_updateItem',
    summary:     'Update a bill line item',
    description: 'Updates a specific item within a bill (quantity, unit price, description, etc.). Bill totals are automatically recalculated. Bill must be in DRAFT or PENDING status.',
  })
  @ApiParam({ name: 'billId',  description: 'Bill UUID',      type: String, format: 'uuid' })
  @ApiParam({ name: 'itemId',  description: 'Bill item UUID', type: String, format: 'uuid' })
  @ApiBody({ type: UpdateBillItemDto })
  @ApiResponse({ status: 200, description: 'Item updated',        type: BillResponseDto })
  @ApiResponse({ status: 400, description: 'Bill not editable or validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Bill or bill item not found' })
  async updateBillItem(
    @Param('billId', ParseUUIDPipe) billId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateBillItemDto,
    @Req() req: Request,
  ): Promise<BillResponseDto> {
    return this.billService.updateBillItem(billId, itemId, dto, req.userId, req.workspaceId);
  }

  @Delete(':billId/items/:itemId')
  @Roles(...ADMIN_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_removeItem',
    summary:     'Remove a line item from a bill',
    description: 'Removes an item from a bill. Returns the updated bill with remaining items.',
  })
  @ApiParam({ name: 'billId',  description: 'Bill UUID',      type: String, format: 'uuid' })
  @ApiParam({ name: 'itemId',  description: 'Bill item UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Item removed, updated bill returned', type: BillResponseDto })
  @ApiResponse({ status: 400, description: 'Bill cannot be modified' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  @ApiResponse({ status: 404, description: 'Bill or item not found' })
  async removeBillItem(
    @Param('billId', ParseUUIDPipe) billId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() req: Request,
  ): Promise<BillResponseDto> {
    return this.billService.removeBillItem(billId, itemId, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // SUB-ROUTES of /:id — declared BEFORE PATCH /:id and GET /:id to prevent
  // the 1-segment param routes from swallowing the literal suffix segments
  // ==========================================================================

  @Get(':id/summary')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_summary',
    summary:     'Get bill summary',
    description: 'Returns a condensed summary of bill header fields and totals.',
  })
  @ApiParam({ name: 'id', description: 'Bill UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Bill summary' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  async getBillSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const bill = await this.billService.getBillById(id, req.workspaceId);
    return {
      billNumber:      (bill as any).billNumber,
      patientId:       (bill as any).patientId,
      issuedAt:        (bill as any).issuedAt,
      dueDate:         (bill as any).dueDate,
      subtotal:        (bill as any).subtotal,
      discountAmount:  (bill as any).discountAmount,
      taxAmount:       (bill as any).taxAmount,
      total:           (bill as any).total,
      status:          (bill as any).status,
      itemCount:       (bill as any).items?.length ?? 0,
    };
  }

  @Get(':id/breakdown')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_breakdown',
    summary:     'Get bill payment breakdown',
    description: 'Returns a detailed breakdown of bill totals, completed payments, and outstanding balance.',
  })
  @ApiParam({ name: 'id', description: 'Bill UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Bill breakdown' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  async getBillBreakdown(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const bill     = await this.billService.getBillById(id, req.workspaceId);
    const payments: any[] = (bill as any).payments ?? [];
    const totalPaid = payments
      .filter((p) => p.status === 'COMPLETED')
      .reduce((sum: number, p) => sum + p.amount, 0);

    return {
      subtotal:   (bill as any).subtotal,
      discount:   (bill as any).discountAmount,
      tax:        (bill as any).taxAmount,
      total:      (bill as any).total,
      paid:       totalPaid,
      balance:    (bill as any).total - totalPaid,
      payments:   payments.map((p) => ({
        id:        p.id,
        amount:    p.amount,
        method:    p.paymentMethod?.type,
        date:      p.paymentDate,
        status:    p.status,
        reference: p.paymentReference,
      })),
    };
  }

  @Post(':id/cancel')
  @Roles(...ADMIN_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_cancel',
    summary:     'Cancel a bill',
    description: 'Cancels a bill and reverses all associated billing transactions. Cannot cancel bills with completed payments.',
  })
  @ApiParam({ name: 'id', description: 'Bill UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Bill cancelled',  type: BillResponseDto })
  @ApiResponse({ status: 400, description: 'Bill cannot be cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  async cancelBill(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<BillResponseDto> {
    return this.billService.cancelBill(id, req.userId, req.workspaceId);
  }

  // ==========================================================================
  // PARAMETERISED ROUTES — declared LAST
  // ==========================================================================

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @Permissions('billing:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_update',
    summary:     'Update bill details',
    description: 'Updates bill header information (status, discount, tax, due date, notes). Bill must be in DRAFT or PENDING status.',
  })
  @ApiParam({ name: 'id', description: 'Bill UUID', type: String, format: 'uuid' })
  @ApiBody({ type: UpdateBillDto })
  @ApiResponse({ status: 200, description: 'Bill updated',    type: BillResponseDto })
  @ApiResponse({ status: 400, description: 'Bill not editable' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  async updateBill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillDto,
    @Req() req: Request,
  ): Promise<BillResponseDto> {
    return this.billService.updateBill(id, dto, req.userId, req.workspaceId);
  }

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'bills_getById',
    summary:     'Get bill by ID',
    description: 'Returns complete bill details including line items, payments, and transactions.',
  })
  @ApiParam({ name: 'id', description: 'Bill UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Bill details', type: BillResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  async getBillById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<BillResponseDto> {
    return this.billService.getBillById(id, req.workspaceId);
  }
}
