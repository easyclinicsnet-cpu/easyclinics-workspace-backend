/**
 * Insurance Claim PDF Controller — v1
 *
 * PDF generation endpoints for insurance claims. Shares the /claims path prefix
 * with InsuranceClaimController. NestJS merges both controllers' routes under
 * the same prefix seamlessly.
 *
 * ┌─ Contract ─────────────────────────────────────────────────────────────────┐
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
 *   GET    /:id/download-pdf     — generate and stream PDF file
 *   GET    /:id/pdf-url          — generate PDF and return accessible URL
 */

import * as fs   from 'fs';
import * as path from 'path';

import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';

// ── Guards ────────────────────────────────────────────────────────────────────
import { WorkspaceJwtGuard }  from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }         from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }   from '../../../common/security/auth/permissions.guard';

// ── Auth decorators ───────────────────────────────────────────────────────────
import { Roles, Permissions } from '../../../common/security/auth/decorators';

// ── RBAC enums ────────────────────────────────────────────────────────────────
import { UserRole } from '../../../common/enums';

// ── Domain services ───────────────────────────────────────────────────────────
import { ClaimPdfService } from '../services/claim-pdf.service';

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

// ---------------------------------------------------------------------------

@ApiTags('Insurance Claims')
@ApiBearerAuth('JWT')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@Controller({ path: 'claims', version: 'v1' })
export class InsuranceClaimPdfController {
  constructor(private readonly claimPdfService: ClaimPdfService) {}

  // ==========================================================================
  // PDF DOWNLOAD — streams the generated PDF back as binary
  // ==========================================================================

  @Get(':id/download-pdf')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'application/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({
    operationId: 'claims_downloadPdf',
    summary:     'Download claim as PDF',
    description: 'Generates a professionally formatted PDF for the insurance claim and streams it as an attachment download. The temporary file is cleaned up server-side after delivery.',
  })
  @ApiParam({ name: 'id', description: 'Claim UUID', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'PDF stream',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  @ApiResponse({ status: 500, description: 'PDF generation failed' })
  async downloadClaimPdf(
    @Param('id', ParseUUIDPipe) claimId: string,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ): Promise<StreamableFile> {
    // generateClaimPdf throws NotFoundException internally if claim is missing
    const pdfPath = await this.claimPdfService.generateClaimPdf(claimId, req.workspaceId);

    const fileBuffer = await fs.promises.readFile(pdfPath);
    const filename   = `claim-${path.basename(pdfPath, '.pdf')}-${Date.now()}.pdf`;

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      fileBuffer.length,
    });

    // Async clean-up after response is sent (best-effort)
    setTimeout(() => {
      this.claimPdfService.deletePdfFile(pdfPath).catch(() => {
        // intentionally swallowed — temporary file cleanup is non-critical
      });
    }, 10_000);

    return new StreamableFile(fileBuffer);
  }

  // ==========================================================================
  // PDF URL — generates PDF and returns an accessible URL for preview
  // ==========================================================================

  @Get(':id/pdf-url')
  @Roles(...VIEWER_ROLES)
  @Permissions('billing:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'claims_pdfUrl',
    summary:     'Get claim PDF URL',
    description: 'Generates a PDF for the claim and returns its server-relative URL for preview or download in the client.',
  })
  @ApiParam({ name: 'id', description: 'Claim UUID', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'PDF URL',
    schema: {
      type: 'object',
      properties: {
        url:      { type: 'string', example: '/uploads/claims/pdfs/claim-CLM-2025-001.pdf' },
        filename: { type: 'string', example: 'claim-CLM-2025-001.pdf' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async getClaimPdfUrl(
    @Param('id', ParseUUIDPipe) claimId: string,
    @Req() req: Request,
  ): Promise<{ url: string; filename: string }> {
    const pdfPath = await this.claimPdfService.generateClaimPdf(claimId, req.workspaceId);
    const filename = path.basename(pdfPath);

    return {
      url:      `/uploads/claims/pdfs/${filename}`,
      filename,
    };
  }
}
