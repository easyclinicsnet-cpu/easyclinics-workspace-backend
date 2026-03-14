/**
 * Patient Dashboard Controller — v1
 *
 * Provides a single, comprehensive endpoint that aggregates data from all
 * EMR domains into one holistic patient view, following clinical best-practice
 * ordering (HL7 / FHIR / Epic / Cerner standard layout).
 *
 * ┌─ Endpoint ──────────────────────────────────────────────────────────────┐
 * │  GET /api/v1/patients/:id/dashboard                                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌─ Security (applied in order) ───────────────────────────────────────────┐
 * │  WorkspaceJwtGuard — validates RS256 JWT, attaches req.user             │
 * │  RolesGuard        — role hierarchy enforcement                         │
 * │  PermissionsGuard  — fine-grained permission check                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ┌─ Response sections ─────────────────────────────────────────────────────┐
 * │  1. patient        — Demographics, contact info, identifiers            │
 * │  2. alerts         — Critical allergies, expired insurance, overdue     │
 * │  3. vitalSigns     — Latest + trend sparklines                          │
 * │  4. medications    — Active prescriptions + chronic repeats             │
 * │  5. appointments   — Upcoming schedule + recent visit history           │
 * │  6. consultations  — Recent consultations with note/Rx counts           │
 * │  7. clinicalHistory— Conditions, surgery, family, social, allergies     │
 * │  8. careNotes      — Published notes preview + referral letters         │
 * │  9. insurance      — Coverage details with expiry status                │
 * │ 10. billing        — Outstanding balance + recent bills                 │
 * │ 11. summary        — Total visit / consultation / Rx counts             │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
import {
  Controller,
  Get,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiParam,
  ApiExtraModels,
} from '@nestjs/swagger';
import { Request } from 'express';

// Guards
import { WorkspaceJwtGuard } from '../../../common/security/auth/workspace-jwt.guard';
import { RolesGuard }        from '../../../common/security/auth/roles.guard';
import { PermissionsGuard }  from '../../../common/security/auth/permissions.guard';

// Decorators
import { Roles } from '../../../common/security/auth/decorators';

// RBAC
import { UserRole } from '../../../common/enums';

// Service
import { PatientDashboardService } from '../services/patient-dashboard.service';

// DTO
import { PatientDashboardResponseDto } from '../dto/patient/patient-dashboard-response.dto';

// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Patients')
@ApiBearerAuth('JWT')
@ApiSecurity('WorkspaceId')
@UseGuards(WorkspaceJwtGuard, RolesGuard, PermissionsGuard)
@ApiExtraModels(PatientDashboardResponseDto)
@Controller({ path: 'patients', version: 'v1' })
export class PatientDashboardController {
  constructor(private readonly dashboardService: PatientDashboardService) {}

  /**
   * GET /api/v1/patients/:id/dashboard
   *
   * Returns a holistic patient view aggregating data from all EMR domains in a
   * single response. Designed for the patient detail / chart page.
   *
   * All sections are fetched in parallel using Promise.all for minimal latency.
   * Every access is HIPAA-logged with user identity, timestamp, and workspace.
   */
  @Get(':id/dashboard')
  @Roles(
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
  )
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'patients_dashboard',
    summary: 'Get comprehensive patient dashboard',
    description:
      'Returns a single holistic patient view that aggregates data from all 8 EMR domains: ' +
      'patients, appointments, consultations, care notes, billing, insurance, inventory, and audit. ' +
      '\n\n' +
      '**Sections returned:**\n' +
      '- `patient` — Decrypted demographics, contact info, MRN, gender, age\n' +
      '- `alerts` — Critical allergy flags, expired insurance, overdue bills\n' +
      '- `vitalSigns` — Latest reading + last-10 trend sparklines (BP, HR, temp, weight, SpO₂, glucose)\n' +
      '- `medications` — Recent prescriptions + all active repeat/chronic medications\n' +
      '- `appointments` — Upcoming schedule (next 5) + recent visit history (last 10)\n' +
      '- `consultations` — Last 5 consultations with note count and prescription count\n' +
      '- `clinicalHistory` — Active conditions, surgical history, family history, social history, allergies\n' +
      '- `careNotes` — Last 5 published notes (200-char preview) + last 5 referral letters\n' +
      '- `insurance` — Coverage details with expiry status and days-until-expiry\n' +
      '- `billing` — Last 5 bills, outstanding balance, total billed, status breakdown\n' +
      '- `summary` — Aggregate totals: visits, consultations, prescriptions, conditions\n' +
      '\n\n' +
      'Every access is HIPAA-logged. All parallel queries complete in a single round-trip.',
  })
  @ApiParam({ name: 'id', description: 'Patient UUID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Comprehensive patient dashboard',
    type: PatientDashboardResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized — JWT missing or invalid' })
  @ApiResponse({ status: 403, description: 'Forbidden — insufficient role' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async getDashboard(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<PatientDashboardResponseDto> {
    return this.dashboardService.getDashboard(id, req.userId, req.workspaceId);
  }
}
