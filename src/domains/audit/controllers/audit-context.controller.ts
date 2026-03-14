/**
 * Audit Context Controller — v1
 *
 * Manages the full lifecycle of complex, multi-step operation contexts.
 * An audit context wraps a business transaction (create → captureState →
 * complete | fail) so that every state transition is immutably recorded.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
 * │  All inputs validated 100 % through DTOs (ValidationPipe enforces)        │
 * │  workspaceId is ALWAYS extracted from the verified JWT                    │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/audit/contexts                    │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Security ──────────────────────────────────────────────────────────────────┐
 * │  WorkspaceJwtGuard → RolesGuard → PermissionsGuard (applied class-level)  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (all routes prefixed /api/v1):
 *   POST   /audit/contexts                          — open a new context
 *   GET    /audit/contexts/pending                  — pending contexts (admin)
 *   GET    /audit/contexts/entity                   — contexts for an entity
 *   GET    /audit/contexts/status                   — contexts by status
 *   GET    /audit/contexts/user/:userId             — contexts by initiating user
 *   PATCH  /audit/contexts/:contextId/capture-state — snapshot entity state
 *   PATCH  /audit/contexts/:contextId/complete      — mark context completed
 *   PATCH  /audit/contexts/:contextId/fail          — mark context failed
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { IsEnum, IsObject, IsString } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Request } from 'express';

// ── Guards ────────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC enums ────────────────────────────────────────────────────────────────
import { UserRole, AuditContextStatus } from '../../../common/enums';

// ── Domain service ────────────────────────────────────────────────────────────
import { AuditContextService } from '../services/audit-context.service';

// ── Domain DTOs ───────────────────────────────────────────────────────────────
import { CreateAuditContextDto, AuditContextResponseDto } from '../dto';

// ---------------------------------------------------------------------------
// Local request-scope DTOs (Swagger-annotated, scoped to this controller)
// ---------------------------------------------------------------------------

/** Body for PATCH capture-state: the state snapshot to record. */
class CaptureStateBodyDto {
  @ApiProperty({
    description:
      'Entity state snapshot. First call sets `previousState`; subsequent calls set `newState`.',
    example: { status: 'SCHEDULED', patientId: 'f47ac10b-...' },
  })
  @IsObject()
  state: Record<string, unknown>;
}

/** Body for PATCH fail: the human-readable failure reason. */
class MarkFailedBodyDto {
  @ApiProperty({
    description: 'Human-readable failure reason, stored for forensic analysis.',
    example: 'Database constraint violation on PatientInsurance upsert',
  })
  @IsString()
  reason: string;
}

/** Query parameters for entity-scoped context lookups. */
class FindByEntityQueryDto {
  @ApiProperty({ description: 'Entity type name', example: 'Patient' })
  @IsString()
  entityType: string;

  @ApiProperty({ description: 'Entity instance UUID', example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
  @IsString()
  entityId: string;
}

/** Query parameters for status-scoped context lookups. */
class FindByStatusQueryDto {
  @ApiProperty({ description: 'Target context status', enum: AuditContextStatus, example: AuditContextStatus.PENDING })
  @IsEnum(AuditContextStatus)
  status: AuditContextStatus;
}

// ---------------------------------------------------------------------------
// Role shorthand groups
// ---------------------------------------------------------------------------

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

const ADMIN_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
];

// ---------------------------------------------------------------------------

@ApiTags('Audit Contexts')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(AuditContextResponseDto, CreateAuditContextDto)
@Controller({ path: 'audit/contexts', version: 'v1' })
export class AuditContextController {
  constructor(private readonly auditContextService: AuditContextService) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  /**
   * POST /api/v1/audit/contexts
   *
   * Opens a new audit context to wrap a complex, multi-step business
   * transaction.  Lifecycle: create → captureState (×n) → complete | fail.
   */
  @Post()
  @Roles(...WRITE_ROLES)
  @Permissions('audit:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'auditContexts_create',
    summary:     'Open a new audit context',
    description:
      'Creates an audit context to track a complex, multi-step operation. ' +
      'Lifecycle: create → captureState (×n) → complete | fail. ' +
      'The context remains PENDING until explicitly resolved.',
  })
  @ApiResponse({ status: 201, description: 'Audit context opened', type: AuditContextResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — clinical or admin role required' })
  async createContext(
    @Body() dto: CreateAuditContextDto,
    @Req() req: Request,
  ): Promise<AuditContextResponseDto> {
    const context = await this.auditContextService.createContext(dto, req.workspaceId);
    return plainToInstance(AuditContextResponseDto, context, { excludeExtraneousValues: true });
  }

  // ==========================================================================
  // READ — static paths before /:contextId
  // ==========================================================================

  /**
   * GET /api/v1/audit/contexts/pending
   */
  @Get('pending')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditContexts_pending',
    summary:     'Get pending audit contexts',
    description:
      'Returns all PENDING audit contexts for the workspace. ' +
      'Long-running pending contexts may indicate stuck processes.',
  })
  @ApiResponse({ status: 200, description: 'Pending audit contexts', type: [AuditContextResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async findPendingContexts(@Req() req: Request): Promise<AuditContextResponseDto[]> {
    const contexts = await this.auditContextService.findPendingContexts(req.workspaceId);
    return plainToInstance(AuditContextResponseDto, contexts, { excludeExtraneousValues: true });
  }

  /**
   * GET /api/v1/audit/contexts/entity?entityType=Patient&entityId=<uuid>
   */
  @Get('entity')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditContexts_byEntity',
    summary:     'Get contexts by entity',
    description:
      'Returns all audit contexts tied to a specific entity type and instance UUID.',
  })
  @ApiQuery({ name: 'entityType', required: true, type: String, description: 'Entity type name',     example: 'Patient' })
  @ApiQuery({ name: 'entityId',   required: true, type: String, description: 'Entity instance UUID', example: 'f47ac10b-...' })
  @ApiResponse({ status: 200, description: 'Entity audit contexts', type: [AuditContextResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async findByEntity(
    @Query() query: FindByEntityQueryDto,
    @Req() req: Request,
  ): Promise<AuditContextResponseDto[]> {
    const contexts = await this.auditContextService.findByEntity(
      query.entityType,
      query.entityId,
      req.workspaceId,
    );
    return plainToInstance(AuditContextResponseDto, contexts, { excludeExtraneousValues: true });
  }

  /**
   * GET /api/v1/audit/contexts/status?status=PENDING
   */
  @Get('status')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditContexts_byStatus',
    summary:     'Get contexts by status',
    description:
      'Returns audit contexts for the workspace filtered by status ' +
      '(PENDING, COMPLETED, FAILED, or REVERSED).',
  })
  @ApiQuery({ name: 'status', required: true, enum: AuditContextStatus, description: 'Target context status', example: AuditContextStatus.FAILED })
  @ApiResponse({ status: 200, description: 'Filtered audit contexts', type: [AuditContextResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async findByStatus(
    @Query() query: FindByStatusQueryDto,
    @Req() req: Request,
  ): Promise<AuditContextResponseDto[]> {
    const contexts = await this.auditContextService.findByStatus(query.status, req.workspaceId);
    return plainToInstance(AuditContextResponseDto, contexts, { excludeExtraneousValues: true });
  }

  /**
   * GET /api/v1/audit/contexts/user/:userId
   */
  @Get('user/:userId')
  @Roles(...ADMIN_ROLES)
  @Permissions('audit:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditContexts_byUser',
    summary:     'Get contexts by user',
    description:
      'Returns all audit contexts initiated by the specified user.',
  })
  @ApiParam({ name: 'userId', description: 'Target user UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User audit contexts', type: [AuditContextResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin role required' })
  async findByUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Request,
  ): Promise<AuditContextResponseDto[]> {
    const contexts = await this.auditContextService.findByUser(userId, req.workspaceId);
    return plainToInstance(AuditContextResponseDto, contexts, { excludeExtraneousValues: true });
  }

  // ==========================================================================
  // LIFECYCLE TRANSITIONS — parameterised /:contextId routes (after static paths)
  // ==========================================================================

  /**
   * PATCH /api/v1/audit/contexts/:contextId/capture-state
   *
   * Records an entity state snapshot. First call → previousState; subsequent → newState.
   */
  @Patch(':contextId/capture-state')
  @Roles(...WRITE_ROLES)
  @Permissions('audit:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditContexts_captureState',
    summary:     'Capture entity state snapshot',
    description:
      'Stores a state snapshot into the audit context. ' +
      'First call → sets `previousState`. Subsequent calls → sets `newState`. ' +
      'Enables before/after diff recording for compliance.',
  })
  @ApiParam({ name: 'contextId', description: 'Audit context UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'State captured', type: AuditContextResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — state must be an object' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Audit context not found' })
  async captureState(
    @Param('contextId', ParseUUIDPipe) contextId: string,
    @Body() body: CaptureStateBodyDto,
    @Req() req: Request,
  ): Promise<AuditContextResponseDto> {
    const context = await this.auditContextService.captureState(contextId, body.state, req.workspaceId);
    return plainToInstance(AuditContextResponseDto, context, { excludeExtraneousValues: true });
  }

  /**
   * PATCH /api/v1/audit/contexts/:contextId/complete
   */
  @Patch(':contextId/complete')
  @Roles(...WRITE_ROLES)
  @Permissions('audit:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditContexts_complete',
    summary:     'Mark context as completed',
    description:
      'Transitions the audit context to COMPLETED and sets `completedAt`. ' +
      'Call this once the wrapped business transaction finishes successfully.',
  })
  @ApiParam({ name: 'contextId', description: 'Audit context UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Context marked completed', type: AuditContextResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Audit context not found' })
  async markCompleted(
    @Param('contextId', ParseUUIDPipe) contextId: string,
    @Req() req: Request,
  ): Promise<AuditContextResponseDto> {
    const context = await this.auditContextService.markCompleted(contextId, req.workspaceId);
    return plainToInstance(AuditContextResponseDto, context, { excludeExtraneousValues: true });
  }

  /**
   * PATCH /api/v1/audit/contexts/:contextId/fail
   */
  @Patch(':contextId/fail')
  @Roles(...WRITE_ROLES)
  @Permissions('audit:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'auditContexts_fail',
    summary:     'Mark context as failed',
    description:
      'Transitions the audit context to FAILED and records the failure reason. ' +
      'Use when the wrapped business transaction encounters an unrecoverable error.',
  })
  @ApiParam({ name: 'contextId', description: 'Audit context UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Context marked failed', type: AuditContextResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — reason is required' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Audit context not found' })
  async markFailed(
    @Param('contextId', ParseUUIDPipe) contextId: string,
    @Body() body: MarkFailedBodyDto,
    @Req() req: Request,
  ): Promise<AuditContextResponseDto> {
    const context = await this.auditContextService.markFailed(contextId, body.reason, req.workspaceId);
    return plainToInstance(AuditContextResponseDto, context, { excludeExtraneousValues: true });
  }
}
