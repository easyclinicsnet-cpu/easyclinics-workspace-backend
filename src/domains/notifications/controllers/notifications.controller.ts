/**
 * Notifications Controller — v1
 *
 * REST endpoints for FCM device token registration and in-app notification
 * management (list, badge, mark-read, dismiss).
 *
 * ┌─ Contract ──────────────────────────────────────────────────────────────────┐
 * │  workspaceId / userId are ALWAYS extracted from the verified JWT via       │
 * │  req.workspaceId and req.userId (set by WorkspaceJwtGuard).               │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Versioning ────────────────────────────────────────────────────────────────┐
 * │  @Version('v1')  → resolves at  /api/v1/notifications                     │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * Route map (static paths declared before parameterised /:id):
 *   POST   /notifications/register-device        — register FCM token
 *   DELETE /notifications/unregister-device       — deactivate FCM token
 *   GET    /notifications                         — list notifications (paginated)
 *   GET    /notifications/unread-count            — badge count
 *   PATCH  /notifications/read-all                — mark all as read
 *   PATCH  /notifications/dismiss-all             — dismiss all
 *   PATCH  /notifications/dismiss-by-job/:jobId   — dismiss by transcription job
 *   PATCH  /notifications/:id/read                — mark one as read
 *   PATCH  /notifications/:id/dismiss             — dismiss one
 */

import {
  Controller,
  Post,
  Delete,
  Get,
  Patch,
  Body,
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
  ApiBody,
} from '@nestjs/swagger';
import { Request } from 'express';

import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';
import { Roles }              from '../../../common/security/auth/decorators';
import { UserRole }           from '../../../common/enums';

import { NotificationsService } from '../services/notifications.service';
import { RegisterDeviceDto, QueryNotificationsDto } from '../dto';

// ---------------------------------------------------------------------------
// Role shorthand groups (mirrors ai-note.controller.ts pattern)
// ---------------------------------------------------------------------------

/** All authenticated clinical + support roles can manage their own notifications. */
const ALL_ROLES = [
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN,
  UserRole.PRACTICE_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.MEDICAL_ASSISTANT,
  UserRole.PHARMACIST,
  UserRole.THERAPIST,
  UserRole.SCHEDULER,
];

// ---------------------------------------------------------------------------

@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'notifications', version: 'v1' })
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  // ==========================================================================
  // WRITE — device token registration
  // ==========================================================================

  /**
   * POST /api/v1/notifications/register-device
   * Registers (or refreshes) an FCM device token for the current user.
   */
  @Post('register-device')
  @Roles(...ALL_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'notifications_registerDevice',
    summary:     'Register an FCM device token',
    description:
      'Registers a Firebase Cloud Messaging device token for the current user ' +
      'and workspace. Deactivates the same token for other users on the device ' +
      'to prevent cross-user push delivery on shared devices.',
  })
  @ApiBody({ type: RegisterDeviceDto })
  @ApiResponse({ status: 201, description: 'Token registered' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async registerDevice(
    @Body() dto: RegisterDeviceDto,
    @Req() req: Request,
  ) {
    return this.notificationsService.registerDevice(
      req.workspaceId,
      req.userId,
      dto,
    );
  }

  /**
   * DELETE /api/v1/notifications/unregister-device
   * Deactivates an FCM token (call on logout or token invalidation).
   */
  @Delete('unregister-device')
  @Roles(...ALL_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'notifications_unregisterDevice',
    summary:     'Unregister an FCM device token',
    description:
      'Deactivates the specified FCM token so the device no longer receives ' +
      'push notifications for this user. Call on logout or token refresh.',
  })
  @ApiResponse({ status: 204, description: 'Token deactivated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async unregisterDevice(
    @Body('deviceToken') deviceToken: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.notificationsService.unregisterDevice(
      req.userId,
      deviceToken,
      req.workspaceId,
    );
  }

  // ==========================================================================
  // READ — static paths (before parameterised /:id routes)
  // ==========================================================================

  /**
   * GET /api/v1/notifications
   * Returns paginated, undismissed notifications for the current user + workspace.
   */
  @Get()
  @Roles(...ALL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'notifications_list',
    summary:     'List notifications (paginated)',
    description:
      'Returns all undismissed notifications for the authenticated user in the ' +
      'current workspace, sorted by most recent first.',
  })
  @ApiResponse({ status: 200, description: 'Paginated notification list' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(
    @Query() query: QueryNotificationsDto,
    @Req() req: Request,
  ) {
    const { data, total, unreadCount } =
      await this.notificationsService.listNotifications(
        req.workspaceId,
        req.userId,
        query,
      );

    return {
      data,
      meta: {
        total,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
        totalPages: Math.ceil(total / (query.limit ?? 20)),
      },
      unreadCount,
    };
  }

  /**
   * GET /api/v1/notifications/unread-count
   * Returns the unread notification count for badge display.
   */
  @Get('unread-count')
  @Roles(...ALL_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'notifications_unreadCount',
    summary:     'Get unread notification count',
    description:
      'Returns the number of unread, undismissed notifications for badge display.',
  })
  @ApiResponse({ status: 200, description: 'Unread count' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async unreadCount(@Req() req: Request) {
    const count = await this.notificationsService.getUnreadCount(
      req.workspaceId,
      req.userId,
    );
    return { unreadCount: count };
  }

  // ==========================================================================
  // WRITE — bulk operations (static paths before parameterised /:id)
  // ==========================================================================

  /**
   * PATCH /api/v1/notifications/read-all
   * Marks all notifications as read for the current user + workspace.
   */
  @Patch('read-all')
  @Roles(...ALL_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'notifications_markAllRead',
    summary:     'Mark all notifications as read',
    description: 'Marks every unread notification as read for the current user in this workspace.',
  })
  @ApiResponse({ status: 204, description: 'All marked as read' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async markAllRead(@Req() req: Request): Promise<void> {
    await this.notificationsService.markAllRead(req.workspaceId, req.userId);
  }

  /**
   * PATCH /api/v1/notifications/dismiss-all
   * Dismisses all notifications for the current user + workspace.
   */
  @Patch('dismiss-all')
  @Roles(...ALL_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'notifications_dismissAll',
    summary:     'Dismiss all notifications',
    description:
      'Soft-deletes all notifications for the current user so they no longer appear in the list.',
  })
  @ApiResponse({ status: 204, description: 'All dismissed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async dismissAll(@Req() req: Request): Promise<void> {
    await this.notificationsService.dismissAll(req.workspaceId, req.userId);
  }

  /**
   * PATCH /api/v1/notifications/dismiss-by-job/:jobId
   * Dismisses all notifications linked to a transcription job.
   */
  @Patch('dismiss-by-job/:jobId')
  @Roles(...ALL_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'notifications_dismissByJobId',
    summary:     'Dismiss notifications by transcription job ID',
    description:
      'Dismisses all notifications whose data.jobId matches the given job ID. ' +
      'Used when the client dismisses a real-time WebSocket notification that ' +
      'does not yet have the backend notification ID.',
  })
  @ApiParam({ name: 'jobId', description: 'Transcription job UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Dismissed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async dismissByJobId(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.notificationsService.dismissByJobId(
      jobId,
      req.userId,
      req.workspaceId,
    );
  }

  // ==========================================================================
  // WRITE — parameterised /:id routes (declared LAST to avoid collisions)
  // ==========================================================================

  /**
   * PATCH /api/v1/notifications/:id/read
   * Marks a single notification as read.
   */
  @Patch(':id/read')
  @Roles(...ALL_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'notifications_markRead',
    summary:     'Mark a notification as read',
    description: 'Marks the specified notification as read, scoped to the current user and workspace.',
  })
  @ApiParam({ name: 'id', description: 'Notification UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Marked as read' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.notificationsService.markRead(id, req.userId, req.workspaceId);
  }

  /**
   * PATCH /api/v1/notifications/:id/dismiss
   * Dismisses a single notification (hides from list permanently).
   */
  @Patch(':id/dismiss')
  @Roles(...ALL_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'notifications_dismiss',
    summary:     'Dismiss a notification',
    description:
      'Soft-deletes the specified notification so it no longer appears in the list. ' +
      'Scoped to the current user and workspace.',
  })
  @ApiParam({ name: 'id', description: 'Notification UUID', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Dismissed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.notificationsService.dismiss(id, req.userId, req.workspaceId);
  }
}
