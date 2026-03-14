/**
 * Audit Log Controller — v1
 *
 * HIPAA-compliant REST API for workspace-scoped audit log management.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100 % through DTOs (ValidationPipe enforces)        │
 * │  All responses typed with explicit DTO return types                       │
 * │  workspaceId is ALWAYS extracted from the verified JWT — never from        │
 * │  request body or URL to prevent tenant-hopping attacks                    │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/audit/logs                        │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security (applied class-level) ────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard  — RS256 token verification + workspace injection       │
 * │  RolesGuard         — role-based enforcement via @Roles()                  │
 * │  PermissionsGuard   — fine-grained permission check via @Permissions()     │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1):
 *   POST   /audit/logs                          — manually create an audit entry
 *   GET    /audit/logs/suspicious               — suspicious-activity alerts (admin)
 *   GET    /audit/logs/statistics               — event-type breakdown
 *   GET    /audit/logs/resource/:type/:id       — logs for a specific resource
 *   GET    /audit/logs/patient/:patientId       — HIPAA patient access trail
 *   GET    /audit/logs/user/:userId             — user activity logs
 *   GET    /audit/logs                          — paginated, filterable list
 *
 * Static paths (suspicious, statistics, resource, patient, user) are declared
 * BEFORE the generic paginated GET so NestJS router never treats literal
 * segments as parameterised placeholders.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
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
  ApiExtraModels,
} from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
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
import { AuditLogService } from '../services/audit-log.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import {
  CreateAuditLogDto,
  QueryAuditLogsDto,
  AuditLogResponseDto,
  PaginatedAuditLogsResponseDto,
} from '../dto';

// ---------------------------------------------------------------------------
// Local request-scope DTOs (used only in this controller)
// ---------------------------------------------------------------------------

/** Query parameters for date-range filtering. */
class DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Range start (ISO 8601)', example: '2025-01-01T00:00:00Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Range end (ISO 8601)', example: '2025-12-31T23:59:59Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

/** Roles that may VIEW audit logs (sensitive compliance data). */
const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
];

/** Roles that may CREATE audit log entries (clinical + admin). */
const WRITE_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.THERAPIST,
  UserRole.PHARMACIST,
];

/** Roles with HIPAA-level patient data access. */
const HIPAA_READ_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
];

// ---------------------------------------------------------------------------

@ApiTags('Audit Logs')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(
  AuditLogResponseDto,
  PaginatedAuditLogsResponseDto,
  CreateAuditLogDto,
  QueryAuditLogsDto,
)
@Controller({ path: 'audit/logs', version: 'v1' })
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  /**
   * POST /api/v1/audit/logs
   *
   * Manually creates an audit log entry. Typically invoked by privileged
   * backend services or system integrations — not by end-users. The
   * workspaceId is always sourced from the verified JWT, never the body.
   */
  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('audit:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'auditLogs_create',
    summary:     'Create audit log entry',
    description:
      'Manually persists an audit log entry. ' +
      'Intended for privileged backend services and system integrations. ' +
      'All PHI fields are redacted by the service before persistence. ' +
      'Requires a clinical or admin role.',
  })
  @ApiResponse({ status: 201, description: 'Audit log entry created', type: AuditLogResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — invalid payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized — JWT missing or invalid' })
  @ApiResponse({ status: 403, description: 'Forbidden — insufficient role' })
  async create(
    @Body() dto: CreateAuditLogDto,
    @Req() req: Request,
  ): Promise<AuditLogResponseDto> {
    const log = await this.auditLogService.log(dto, req.workspaceId);
    return plainToInstance(AuditLogResponseDto, log, { excludeExtraneousValues: true });
  }

  // ==========================================================================
  // SUSPICIOUS ACTIVITY — static path declared before /:id-style routes
  // ==========================================================================

  /**
   * GET /api/v1/audit/logs/suspicious
   *
   * Returns audit log entries flagged as suspicious — records where the same
   * user triggered multiple FAILURE outcomes within a 1-hour window.
   * Restricted to admin roles for security.
   */
  @Get('suspicious')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditLogs_suspicious',
    summary:     'Get suspicious activity logs',
    description:
      'Returns audit logs flagged as suspicious (multiple FAILURE outcomes within 1 hour per user). ' +
      'Used for insider-threat detection and security monitoring. ' +
      'Restricted to admin roles.',
  })
  @ApiResponse({ status: 200, description: 'Suspicious audit entries', type: [AuditLogResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async findSuspiciousActivity(@Req() req: Request): Promise<AuditLogResponseDto[]> {
    const logs = await this.auditLogService.findSuspiciousActivity(req.workspaceId);
    return plainToInstance(AuditLogResponseDto, logs, { excludeExtraneousValues: true });
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * GET /api/v1/audit/logs/statistics?startDate=&endDate=
   *
   * Returns event-type count breakdown over the specified date range.
   * Defaults to the last 30 days when no range is supplied.
   */
  @Get('statistics')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditLogs_statistics',
    summary:     'Get audit log statistics',
    description:
      'Returns a breakdown of audit event counts grouped by event type. ' +
      'Defaults to the last 30 days when no date range is supplied. ' +
      'Used for compliance dashboards and security reporting.',
  })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'Range start (ISO 8601)', example: '2025-01-01T00:00:00Z' })
  @ApiQuery({ name: 'endDate',   required: false, type: String, description: 'Range end (ISO 8601)',   example: '2025-12-31T23:59:59Z' })
  @ApiResponse({ status: 200, description: 'Event-type count map (key = eventType, value = count)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async getStatistics(
    @Query() query: DateRangeQueryDto,
    @Req() req: Request,
  ): Promise<Record<string, number>> {
    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    return this.auditLogService.getStatistics(req.workspaceId, startDate, endDate);
  }

  // ==========================================================================
  // BY RESOURCE
  // ==========================================================================

  /**
   * GET /api/v1/audit/logs/resource/:resourceType/:resourceId
   *
   * Retrieves all audit logs for a given resource type and instance UUID
   * (e.g., `resourceType=Patient`, `resourceId=<uuid>`).
   */
  @Get('resource/:resourceType/:resourceId')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditLogs_byResource',
    summary:     'Get audit logs by resource',
    description:
      'Retrieves all audit entries for a specific entity type and instance. ' +
      'Example: `GET /audit/logs/resource/Patient/{uuid}` returns every ' +
      'action ever taken on that patient record.',
  })
  @ApiParam({ name: 'resourceType', description: 'Entity type name', type: String, example: 'Patient' })
  @ApiParam({ name: 'resourceId',   description: 'Entity instance UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Audit entries for the resource', type: [AuditLogResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async findByResource(
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
    @Req() req: Request,
  ): Promise<AuditLogResponseDto[]> {
    const logs = await this.auditLogService.findByResource(resourceType, resourceId, req.workspaceId);
    return plainToInstance(AuditLogResponseDto, logs, { excludeExtraneousValues: true });
  }

  // ==========================================================================
  // BY PATIENT — HIPAA access trail
  // ==========================================================================

  /**
   * GET /api/v1/audit/logs/patient/:patientId
   *
   * Returns the full PHI access audit trail for a specific patient.
   * HIPAA §164.312(b) requires audit controls for all PHI access events.
   * Restricted to doctors and admin roles.
   */
  @Get('patient/:patientId')
  @Roles(...HIPAA_READ_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditLogs_byPatient',
    summary:     'Get patient audit trail (HIPAA)',
    description:
      'Returns the complete PHI access audit trail for a patient. ' +
      'Required by HIPAA §164.312(b) for compliance reporting. ' +
      'Restricted to doctor and admin roles.',
  })
  @ApiParam({ name: 'patientId', description: 'Patient UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Patient access audit trail', type: [AuditLogResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — doctor or admin role required' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Req() req: Request,
  ): Promise<AuditLogResponseDto[]> {
    const logs = await this.auditLogService.findByPatient(patientId, req.workspaceId);
    return plainToInstance(AuditLogResponseDto, logs, { excludeExtraneousValues: true });
  }

  // ==========================================================================
  // BY USER
  // ==========================================================================

  /**
   * GET /api/v1/audit/logs/user/:userId?startDate=&endDate=
   *
   * Returns audit logs for a specific user within an optional date range.
   * Used for user-activity analysis and insider-threat investigation.
   */
  @Get('user/:userId')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditLogs_byUser',
    summary:     'Get user activity logs',
    description:
      'Returns all audit log entries for a specific user within an optional date range. ' +
      'Useful for user-activity analysis, insider-threat investigation, and HR audits. ' +
      'Restricted to admin roles.',
  })
  @ApiParam({ name: 'userId', description: 'Target user UUID', type: String, format: 'uuid' })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'Range start (ISO 8601)', example: '2025-01-01T00:00:00Z' })
  @ApiQuery({ name: 'endDate',   required: false, type: String, description: 'Range end (ISO 8601)',   example: '2025-12-31T23:59:59Z' })
  @ApiResponse({ status: 200, description: 'User activity audit logs', type: [AuditLogResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async findByUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: DateRangeQueryDto,
    @Req() req: Request,
  ): Promise<AuditLogResponseDto[]> {
    const dateRange =
      query.startDate || query.endDate
        ? {
            startDate: query.startDate ? new Date(query.startDate) : undefined,
            endDate:   query.endDate   ? new Date(query.endDate)   : undefined,
          }
        : undefined;
    const logs = await this.auditLogService.findByUser(userId, req.workspaceId, dateRange);
    return plainToInstance(AuditLogResponseDto, logs, { excludeExtraneousValues: true });
  }

  // ==========================================================================
  // PAGINATED LIST — declared last (catch-all GET)
  // ==========================================================================

  /**
   * GET /api/v1/audit/logs
   *
   * Returns a paginated, filterable list of audit log entries for the caller's
   * workspace. Supports filtering by userId, eventType, outcome, resourceType,
   * date range, and free-text search.
   */
  @Get()
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditLogs_list',
    summary:     'List audit logs',
    description:
      'Returns a paginated list of audit entries for the workspace. ' +
      'Supports filtering by `userId`, `eventType`, `outcome`, `resourceType`, ' +
      'date range (`startDate`/`endDate`), and free-text `search`. ' +
      'Restricted to admin roles.',
  })
  @ApiQuery({ name: 'page',         required: false, type: Number,  description: 'Page number (1-based)', example: 1 })
  @ApiQuery({ name: 'limit',        required: false, type: Number,  description: 'Records per page (max 100)', example: 20 })
  @ApiQuery({ name: 'userId',       required: false, type: String,  description: 'Filter by user UUID' })
  @ApiQuery({ name: 'eventType',    required: false, type: String,  description: 'Filter by event type (CREATE, READ, UPDATE, DELETE …)' })
  @ApiQuery({ name: 'outcome',      required: false, type: String,  description: 'Filter by outcome (SUCCESS | FAILURE)' })
  @ApiQuery({ name: 'resourceType', required: false, type: String,  description: 'Filter by entity type (e.g. Patient, Appointment)' })
  @ApiQuery({ name: 'startDate',    required: false, type: String,  description: 'Range start (ISO 8601)' })
  @ApiQuery({ name: 'endDate',      required: false, type: String,  description: 'Range end (ISO 8601)' })
  @ApiQuery({ name: 'search',       required: false, type: String,  description: 'Full-text search term' })
  @ApiResponse({ status: 200, description: 'Paginated audit log list', type: PaginatedAuditLogsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  @ApiResponse({ status: 422, description: 'Validation error — invalid query parameters' })
  async findAll(
    @Query() query: QueryAuditLogsDto,
    @Req() req: Request,
  ): Promise<PaginatedAuditLogsResponseDto> {
    const result = await this.auditLogService.findAll(query, req.workspaceId);
    return {
      data: plainToInstance(AuditLogResponseDto, result.data, { excludeExtraneousValues: true }),
      meta: result.meta,
    };
  }
}
