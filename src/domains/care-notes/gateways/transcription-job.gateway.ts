import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';

import { LoggerService } from '../../../common/logger/logger.service';
import { TranscriptionJobRepository } from '../repositories/transcription-job.repository';
import {
  TranscriptionStatus,
  TranscriptionStep,
  TranscriptionMode,
} from '../../../common/enums';

// =============================================================================
// Event shape emitted to clients
// =============================================================================

export interface TranscriptionProgressEvent {
  jobId: string;
  /** Included so clients can verify ownership (defense-in-depth). */
  doctorId: string;
  /** Included so clients can verify workspace scope (defense-in-depth). */
  workspaceId: string;
  mode: TranscriptionMode;
  status: TranscriptionStatus;
  currentStep: TranscriptionStep;
  progressPercentage: number;
  progressMessage: string;
  consultationId: string;
  patientName?: string;
  noteType?: string;
  transcriptId?: string;
  noteId?: string;
  transcriptPreview?: string;
  isStructured?: boolean;
  resolvedProvider?: string;
  resolvedModel?: string;
  processingTimeMs?: number;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  updatedAt: Date;
  /** Backend notification ID — included on completed/failed events so clients can dismiss/read without a separate lookup. */
  notificationId?: string;
}

// =============================================================================
// Gateway
// =============================================================================

/**
 * TranscriptionJobGateway
 *
 * WebSocket gateway for real-time transcription job status updates.
 *
 * Connection:
 *   Client connects to namespace /transcription-jobs with JWT in handshake:
 *   ```ts
 *   const socket = io('/transcription-jobs', {
 *     auth: { token: 'Bearer <jwt>' },
 *   });
 *   ```
 *
 * On connect the client is automatically joined to their personal room:
 *   workspace:{workspaceId}:doctor:{userId}
 *
 * Client events (client → server):
 *   subscribeToJob   { jobId: string }  – join the job-specific room
 *   unsubscribeFromJob { jobId: string } – leave the job-specific room
 *
 * Server events (server → client):
 *   transcription.progress   – any status/step change
 *   transcription.completed  – job reached COMPLETED or PENDING_NOTE_GENERATION
 *   transcription.failed     – permanent failure (after all retries)
 *   transcription.cancelled  – job cancelled by doctor
 */
@Injectable()
@WebSocketGateway({
  namespace: 'transcription-jobs',
  cors: {
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      const allowed = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) || [];
      if (allowed.includes(origin) || process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000,
})
export class TranscriptionJobGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private publicKey: crypto.KeyObject | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly transcriptionRepo: TranscriptionJobRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('TranscriptionJobGateway');
    this.loadPublicKey();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  afterInit(_server: Server): void {
    this.logger.log('TranscriptionJob WebSocket gateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.warn(`WS: No token — disconnecting ${client.id}`);
        client.disconnect();
        return;
      }

      const payload = await this.validateToken(token);
      if (!payload) {
        client.disconnect();
        return;
      }

      // Store user context on socket data for use in event handlers
      client.data.userId      = payload.sub;
      client.data.workspaceId = payload.workspaceId;
      client.data.role        = payload.role;

      // Auto-join personal room on connect
      const room = this.doctorRoom(payload.workspaceId, payload.sub);
      await client.join(room);

      this.logger.log(
        `WS: connected ${client.id} → user=${payload.sub} workspace=${payload.workspaceId}`,
      );
    } catch (err) {
      this.logger.error(`WS: connection error ${client.id}: ${err.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(
      `WS: disconnected ${client.id} (user=${client.data?.userId ?? 'unknown'})`,
    );
  }

  // ===========================================================================
  // Client-initiated events
  // ===========================================================================

  /**
   * Subscribe to updates for a specific job.
   * Joins the job-scoped room so the client receives events for that job even
   * if another device/tab initiated it.
   *
   * Server-side authorization: verifies the requesting user owns the job
   * and belongs to the same workspace.
   */
  @SubscribeMessage('subscribeToJob')
  async handleSubscribeToJob(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { jobId: string },
  ): Promise<void> {
    if (!client.data?.userId) {
      throw new WsException('Unauthorized');
    }

    // Verify the client owns this job
    const job = await this.transcriptionRepo.findOne({
      where: { id: data.jobId, workspaceId: client.data.workspaceId },
    });

    if (!job) {
      throw new WsException('Job not found');
    }

    if (job.doctorId !== client.data.userId) {
      throw new WsException('Forbidden: not the job owner');
    }

    const room = this.jobRoom(data.jobId);
    await client.join(room);
    this.logger.debug(`WS: ${client.id} subscribed to job ${data.jobId}`);
  }

  @SubscribeMessage('unsubscribeFromJob')
  async handleUnsubscribeFromJob(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { jobId: string },
  ): Promise<void> {
    const room = this.jobRoom(data.jobId);
    await client.leave(room);
    this.logger.debug(`WS: ${client.id} unsubscribed from job ${data.jobId}`);
  }

  // ===========================================================================
  // Emit helpers — called by TranscriptionJobService
  // ===========================================================================

  /**
   * Emit a progress/step update.
   * Sent on every state transition inside the processing pipeline.
   */
  emit(
    workspaceId: string,
    doctorId: string,
    event: TranscriptionProgressEvent,
  ): void {
    if (!this.server) return; // gateway not fully initialised yet

    const rooms = [this.doctorRoom(workspaceId, doctorId), this.jobRoom(event.jobId)];
    this.server.to(rooms).emit('transcription.progress', event);

    this.logger.debug(
      `WS emit transcription.progress jobId=${event.jobId} ` +
      `status=${event.status} pct=${event.progressPercentage}%`,
    );
  }

  /**
   * Emit when the job is complete and the transcript is ready for note generation.
   * Separate event so clients can show a distinct "ready" notification.
   */
  emitCompleted(
    workspaceId: string,
    doctorId: string,
    event: TranscriptionProgressEvent,
  ): void {
    if (!this.server) return;

    const rooms = [this.doctorRoom(workspaceId, doctorId), this.jobRoom(event.jobId)];
    this.server.to(rooms).emit('transcription.completed', event);

    this.logger.log(
      `WS emit transcription.completed jobId=${event.jobId} transcriptId=${event.transcriptId}`,
    );
  }

  /**
   * Emit when a job permanently fails (all retries exhausted).
   */
  emitFailed(
    workspaceId: string,
    doctorId: string,
    event: TranscriptionProgressEvent,
  ): void {
    if (!this.server) return;

    const rooms = [this.doctorRoom(workspaceId, doctorId), this.jobRoom(event.jobId)];
    this.server.to(rooms).emit('transcription.failed', event);

    this.logger.warn(
      `WS emit transcription.failed jobId=${event.jobId} error=${event.errorMessage}`,
    );
  }

  /**
   * Emit when a job is cancelled by the doctor.
   */
  emitCancelled(
    workspaceId: string,
    doctorId: string,
    event: TranscriptionProgressEvent,
  ): void {
    if (!this.server) return;

    const rooms = [this.doctorRoom(workspaceId, doctorId), this.jobRoom(event.jobId)];
    this.server.to(rooms).emit('transcription.cancelled', event);

    this.logger.log(`WS emit transcription.cancelled jobId=${event.jobId}`);
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private doctorRoom(workspaceId: string, userId: string): string {
    return `workspace:${workspaceId}:doctor:${userId}`;
  }

  private jobRoom(jobId: string): string {
    return `job:${jobId}`;
  }

  private extractToken(client: Socket): string | null {
    // Preferred: handshake auth  { auth: { token: 'Bearer <jwt>' } }
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) {
      return authToken.startsWith('Bearer ') ? authToken.split(' ')[1] : authToken;
    }
    // Fallback: query ?token=<jwt>
    const queryToken = client.handshake.query?.token as string | undefined;
    return queryToken ?? null;
  }

  private async validateToken(token: string): Promise<any | null> {
    try {
      // In dev without a key, accept all connections
      if (!this.publicKey) {
        if (this.configService.get('NODE_ENV') !== 'production') {
          const decoded = this.jwtService.decode(token) as any;
          if (decoded?.sub && decoded?.workspaceId) return decoded;
        }
        throw new Error('No public key configured');
      }

      const decoded = this.jwtService.decode(token, { complete: true }) as any;
      if (!decoded || decoded.header?.alg !== 'RS256') {
        throw new Error('Invalid token format');
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.publicKey as any,
        algorithms: ['RS256'],
        clockTolerance: 15,
        ignoreExpiration: false,
      });

      if (!payload.sub || !payload.workspaceId) {
        throw new Error('Token missing required claims');
      }

      return payload;
    } catch (err) {
      this.logger.warn(`WS: token validation failed — ${err.message}`);
      return null;
    }
  }

  private loadPublicKey(): void {
    try {
      const keyPath = this.configService.get<string>('AUTH_PUBLIC_KEY') ?? '';
      if (!keyPath) {
        if (this.configService.get('NODE_ENV') !== 'production') {
          this.logger.warn('WS: AUTH_PUBLIC_KEY not set — dev mode, RS256 verification skipped');
          return;
        }
        throw new Error('AUTH_PUBLIC_KEY is required in production');
      }
      const pem = readFileSync(join(process.cwd(), keyPath), 'utf8').trim();
      this.publicKey = crypto.createPublicKey({ key: pem, format: 'pem' });
      this.logger.log('WS: public key loaded successfully');
    } catch (err) {
      this.logger.error(`WS: failed to load public key — ${err.message}`);
    }
  }
}
