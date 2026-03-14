import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';
import { InsuranceClaim } from '../../insurance/entities/insurance-claim.entity';
import { InsuranceClaimItem } from '../../insurance/entities/insurance-claim-item.entity';
import { InsuranceProvider } from '../../insurance/entities/insurance-provider.entity';
import { PatientInsurance } from '../../insurance/entities/patient-insurance.entity';
import { PatientBillRepository } from '../repositories/patient-bill.repository';
import { BillItemRepository } from '../repositories/bill-item.repository';

/**
 * Structured claim data used to populate a PDF template.
 */
export interface ClaimPdfData {
  /** Claim header information */
  claimNumber: string;
  claimDate: Date;
  serviceDate: Date;
  serviceEndDate?: Date;

  /** Facility / workspace information */
  facilityName?: string;
  facilityAddress?: string;
  facilityPhone?: string;
  facilityEmail?: string;

  /** Insurance provider details */
  providerName: string;
  providerCode: string;
  providerAddress?: string;

  /** Patient details (PHI - handle with care) */
  patientName: string;
  patientId: string;
  membershipNumber: string;
  policyNumber?: string;
  schemeName: string;

  /** Diagnosis */
  diagnosisCode?: string;
  diagnosisDescription?: string;

  /** Claim items */
  items: ClaimPdfLineItem[];

  /** Totals */
  totalClaimedAmount: number;
  totalApprovedAmount: number;
  totalDeniedAmount: number;
  patientResponsibility: number;

  /** Status and workflow */
  status: string;
  submittedDate?: Date;
  processedDate?: Date;
  denialReason?: string;

  /** Notes and metadata */
  notes?: string;
  authorizationNumber?: string;
}

/**
 * Line item data for the PDF claim form.
 */
export interface ClaimPdfLineItem {
  lineNumber: number;
  description: string;
  procedureCode?: string;
  revenueCode?: string;
  quantity: number;
  unitPrice: number;
  claimedAmount: number;
  approvedAmount: number;
  deniedAmount: number;
  status: string;
}

/**
 * Service for generating structured claim data for PDF rendering.
 *
 * This service assembles all the data needed to render an insurance claim
 * as a PDF document. The actual PDF rendering is delegated to the
 * presentation layer; this service provides the data contract.
 *
 * PHI Note: The output of this service contains Protected Health Information.
 * Ensure that any downstream rendering/storage/transmission of this data
 * complies with HIPAA requirements.
 */
@Injectable()
export class ClaimPdfService {
  constructor(
    @InjectRepository(InsuranceClaim)
    private readonly claimRepository: Repository<InsuranceClaim>,
    @InjectRepository(InsuranceClaimItem)
    private readonly claimItemRepository: Repository<InsuranceClaimItem>,
    @InjectRepository(InsuranceProvider)
    private readonly providerRepository: Repository<InsuranceProvider>,
    @InjectRepository(PatientInsurance)
    private readonly patientInsuranceRepository: Repository<PatientInsurance>,
    private readonly patientBillRepository: PatientBillRepository,
    private readonly billItemRepository: BillItemRepository,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('ClaimPdfService');
  }

  /**
   * Assemble all data required to render a claim PDF.
   *
   * Loads the claim, its items, associated insurance provider, patient
   * insurance record, and bill data. Returns a strongly-typed DTO that
   * can be passed directly to a PDF template engine.
   *
   * @param claimId     Insurance claim ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Structured claim data for PDF rendering
   */
  async getClaimPdfData(
    claimId: string,
    workspaceId: string,
    userId?: string,
  ): Promise<ClaimPdfData> {
    this.logger.log(`Assembling claim PDF data for claim: ${claimId}`);

    try {
      // 1. Load claim with relations
      const claim = await this.claimRepository.findOne({
        where: { id: claimId, isActive: true },
        relations: ['patient', 'insuranceProvider', 'patientInsurance'],
      });

      if (!claim) {
        throw new NotFoundException(
          `Insurance claim with ID ${claimId} not found`,
        );
      }

      // 2. Load claim items
      const claimItems = await this.claimItemRepository.find({
        where: { claimId: claim.id, isActive: true },
        order: { lineNumber: 'ASC' },
      });

      // 3. Load insurance provider details
      const provider = claim.insuranceProvider
        || await this.providerRepository.findOne({
          where: { id: claim.insuranceProviderId, isActive: true },
        });

      // 4. Load patient insurance record with scheme
      const patientInsurance = claim.patientInsurance
        || await this.patientInsuranceRepository.findOne({
          where: { id: claim.patientInsuranceId, isActive: true },
          relations: ['scheme'],
        });

      // 5. Build patient name
      const patientName = claim.patient
        ? `${claim.patient.firstName || ''} ${claim.patient.lastName || ''}`.trim()
        : claim.patientId;

      // 6. Map claim items to PDF line items
      const items: ClaimPdfLineItem[] = claimItems.map((item, index) => ({
        lineNumber: item.lineNumber || index + 1,
        description: item.serviceDescription || item.procedureCode || 'Service',
        procedureCode: item.procedureCode,
        revenueCode: item.revenueCode,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        claimedAmount: Number(item.claimedAmount),
        approvedAmount: Number(item.approvedAmount) || 0,
        deniedAmount: Number(item.deniedAmount) || 0,
        status: item.status,
      }));

      // 7. Assemble the PDF data structure
      const pdfData: ClaimPdfData = {
        claimNumber: claim.claimNumber,
        claimDate: claim.createdAt,
        serviceDate: claim.serviceDate,
        serviceEndDate: claim.serviceEndDate,

        providerName: provider?.name || 'Unknown Provider',
        providerCode: provider?.providerCode || '',
        providerAddress: provider?.address,

        patientName,
        patientId: claim.patientId,
        membershipNumber: patientInsurance?.membershipNumber || '',
        policyNumber: patientInsurance?.policyNumber,
        schemeName: patientInsurance?.scheme?.schemeName || '',

        diagnosisCode: claim.diagnosisCode,
        diagnosisDescription: claim.diagnosisDescription,

        items,

        totalClaimedAmount: Number(claim.totalClaimedAmount),
        totalApprovedAmount: Number(claim.totalApprovedAmount) || 0,
        totalDeniedAmount: Number(claim.totalDeniedAmount) || 0,
        patientResponsibility: Number(claim.patientResponsibilityAmount) || 0,

        status: claim.status,
        submittedDate: claim.submittedDate,
        processedDate: claim.processedDate,
        denialReason: claim.denialReason,

        authorizationNumber: claim.authorizationNumber,
      };

      this.logger.log(
        `Claim PDF data assembled for ${claim.claimNumber} with ${items.length} line items`,
      );

      try {
        await this.auditLogService.log({
          userId: userId || 'system',
          action: 'READ_CLAIM_PDF_DATA',
          eventType: AuditEventType.READ,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'InsuranceClaim',
          resourceId: claimId,
          patientId: claim.patientId,
          justification: 'Insurance claim PDF data assembled (contains PHI)',
          metadata: {
            claimNumber: claim.claimNumber,
            lineItemCount: items.length,
            status: claim.status,
          },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log for getClaimPdfData', (auditError as Error).stack);
      }

      return pdfData;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to assemble claim PDF data for claim ${claimId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Get PDF data for all claims associated with a specific bill.
   *
   * @param billId      Bill ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of structured claim data
   */
  async getClaimPdfDataByBill(
    billId: string,
    workspaceId: string,
  ): Promise<ClaimPdfData[]> {
    this.logger.log(`Assembling claim PDF data for bill: ${billId}`);

    try {
      const claims = await this.claimRepository.find({
        where: { billId, isActive: true },
        order: { createdAt: 'ASC' },
      });

      const pdfDataList: ClaimPdfData[] = [];
      for (const claim of claims) {
        const pdfData = await this.getClaimPdfData(claim.id, workspaceId);
        pdfDataList.push(pdfData);
      }

      return pdfDataList;
    } catch (error) {
      this.logger.error(
        `Failed to assemble claim PDF data for bill ${billId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // PDF Generation (delegates to PDFKit in presentation layer)
  // ---------------------------------------------------------------------------

  /**
   * Generate the actual PDF file for an insurance claim.
   *
   * Assembles the claim data, creates a PDF document using PDFKit,
   * and writes it to the configured upload path.
   *
   * NOTE: PDFKit import is dynamic to keep it as an optional dependency.
   * Install `pdfkit` and `@types/pdfkit` when ready to use this method.
   *
   * @param claimId     Insurance claim ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Path to the generated PDF file
   */
  async generateClaimPdf(
    claimId: string,
    workspaceId: string,
  ): Promise<string> {
    this.logger.log(`Generating claim PDF for claim: ${claimId}`);

    const pdfData = await this.getClaimPdfData(claimId, workspaceId);

    // Determine output directory
    const uploadDir = './uploads/claims';
    await this.ensureDirectoryExists(uploadDir);

    const filename = `claim-${pdfData.claimNumber}-${Date.now()}.pdf`;
    const filepath = `${uploadDir}/${filename}`;

    await this.createPdfDocument(pdfData, filepath);

    this.logger.log(`Claim PDF generated: ${filepath}`);
    return filepath;
  }

  /**
   * Create the PDF document using PDFKit.
   *
   * Builds a professional insurance claim form with:
   * - Header with clinic/facility details and claim number
   * - Patient and insurance provider information
   * - Claim items table grouped by category
   * - Summary totals (claimed, approved, denied, patient responsibility)
   * - Footer with confidentiality notice
   *
   * @param pdfData  Structured claim data
   * @param filepath Output file path
   */
  private async createPdfDocument(
    pdfData: ClaimPdfData,
    filepath: string,
  ): Promise<void> {
    // Dynamic import to keep PDFKit as optional dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PDFDocument = require('pdfkit');
    const fs = require('fs');

    return new Promise<void>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 40, bottom: 40, left: 50, right: 50 },
          info: {
            Title: `Insurance Claim - ${pdfData.claimNumber}`,
            Author: 'EasyClinics EMR',
            Subject: 'Insurance Claim Form',
          },
        });

        const stream = fs.createWriteStream(filepath);
        doc.pipe(stream);

        // ─── Header ────────────────────────────────────────────────────
        if (pdfData.facilityName) {
          doc.fontSize(14).font('Helvetica-Bold').text(pdfData.facilityName, { align: 'center' });
        }
        if (pdfData.facilityAddress) {
          doc.fontSize(8).font('Helvetica').text(pdfData.facilityAddress, { align: 'center' });
        }
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica-Bold').text('INSURANCE CLAIM FORM', { align: 'center' });
        doc.moveDown(0.5);

        // ─── Claim Info ────────────────────────────────────────────────
        doc.fontSize(9).font('Helvetica-Bold').text('Claim Information');
        doc.fontSize(8).font('Helvetica');
        doc.text(`Claim Number: ${pdfData.claimNumber}`);
        doc.text(`Claim Date: ${this.formatDate(pdfData.claimDate)}`);
        doc.text(`Service Date: ${this.formatDate(pdfData.serviceDate)}`);
        if (pdfData.serviceEndDate) {
          doc.text(`Service End Date: ${this.formatDate(pdfData.serviceEndDate)}`);
        }
        doc.text(`Status: ${pdfData.status}`);
        if (pdfData.authorizationNumber) {
          doc.text(`Authorization #: ${pdfData.authorizationNumber}`);
        }
        doc.moveDown();

        // ─── Insurance Provider ────────────────────────────────────────
        doc.fontSize(9).font('Helvetica-Bold').text('Insurance Provider');
        doc.fontSize(8).font('Helvetica');
        doc.text(`Provider: ${pdfData.providerName} (${pdfData.providerCode})`);
        if (pdfData.providerAddress) {
          doc.text(`Address: ${pdfData.providerAddress}`);
        }
        doc.moveDown();

        // ─── Patient Details ───────────────────────────────────────────
        doc.fontSize(9).font('Helvetica-Bold').text('Patient Details');
        doc.fontSize(8).font('Helvetica');
        doc.text(`Patient: ${pdfData.patientName}`);
        doc.text(`Membership #: ${pdfData.membershipNumber}`);
        if (pdfData.policyNumber) {
          doc.text(`Policy #: ${pdfData.policyNumber}`);
        }
        doc.text(`Scheme: ${pdfData.schemeName}`);
        if (pdfData.diagnosisCode) {
          doc.text(`Diagnosis: ${pdfData.diagnosisCode} - ${pdfData.diagnosisDescription || ''}`);
        }
        doc.moveDown();

        // ─── Items Table ───────────────────────────────────────────────
        doc.fontSize(9).font('Helvetica-Bold').text('Claim Items');
        doc.moveDown(0.3);

        // Table header
        const tableTop = doc.y;
        const col = { line: 50, desc: 70, qty: 280, unit: 320, claimed: 380, approved: 440, status: 500 };

        doc.fontSize(7).font('Helvetica-Bold');
        doc.text('#', col.line, tableTop);
        doc.text('Description', col.desc, tableTop);
        doc.text('Qty', col.qty, tableTop);
        doc.text('Unit', col.unit, tableTop);
        doc.text('Claimed', col.claimed, tableTop);
        doc.text('Approved', col.approved, tableTop);
        doc.text('Status', col.status, tableTop);

        doc.moveTo(50, tableTop + 12).lineTo(560, tableTop + 12).stroke();

        // Table rows
        let rowY = tableTop + 16;
        doc.fontSize(7).font('Helvetica');

        for (const item of pdfData.items) {
          if (rowY > 720) {
            doc.addPage();
            rowY = 50;
          }

          doc.text(String(item.lineNumber), col.line, rowY);
          doc.text(item.description.substring(0, 30), col.desc, rowY);
          doc.text(String(item.quantity), col.qty, rowY);
          doc.text(this.formatCurrency(item.unitPrice), col.unit, rowY);
          doc.text(this.formatCurrency(item.claimedAmount), col.claimed, rowY);
          doc.text(this.formatCurrency(item.approvedAmount), col.approved, rowY);
          doc.text(item.status, col.status, rowY);
          rowY += 14;
        }

        // ─── Totals ───────────────────────────────────────────────────
        rowY += 8;
        doc.moveTo(50, rowY).lineTo(560, rowY).stroke();
        rowY += 6;

        doc.fontSize(8).font('Helvetica-Bold');
        doc.text('Total Claimed:', col.claimed - 80, rowY);
        doc.text(this.formatCurrency(pdfData.totalClaimedAmount), col.claimed, rowY);
        rowY += 14;
        doc.text('Total Approved:', col.claimed - 80, rowY);
        doc.text(this.formatCurrency(pdfData.totalApprovedAmount), col.claimed, rowY);
        rowY += 14;
        doc.text('Total Denied:', col.claimed - 80, rowY);
        doc.text(this.formatCurrency(pdfData.totalDeniedAmount), col.claimed, rowY);
        rowY += 14;
        doc.text('Patient Responsibility:', col.claimed - 80, rowY);
        doc.text(this.formatCurrency(pdfData.patientResponsibility), col.claimed, rowY);

        // ─── Denial Reason ─────────────────────────────────────────────
        if (pdfData.denialReason) {
          rowY += 24;
          doc.fontSize(8).font('Helvetica-Bold').text('Denial Reason:', 50, rowY);
          doc.font('Helvetica').text(pdfData.denialReason, 50, rowY + 12, { width: 500 });
        }

        // ─── Footer ───────────────────────────────────────────────────
        doc.fontSize(6).font('Helvetica').text(
          'CONFIDENTIAL: This document contains Protected Health Information (PHI). ' +
          'Unauthorized disclosure is prohibited under HIPAA regulations.',
          50,
          750,
          { align: 'center', width: 500 },
        );

        doc.end();

        stream.on('finish', resolve);
        stream.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Ensure a directory exists, creating it recursively if needed.
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    const fs = require('fs').promises;
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Delete a previously generated PDF file.
   *
   * @param filepath Path to the PDF file to delete
   */
  async deletePdfFile(filepath: string): Promise<void> {
    const fs = require('fs').promises;
    try {
      await fs.unlink(filepath);
      this.logger.log(`Deleted claim PDF: ${filepath}`);
    } catch (error) {
      this.logger.warn(
        `Failed to delete claim PDF ${filepath}: ${(error as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private Formatting Helpers
  // ---------------------------------------------------------------------------

  private formatDate(date: Date | string | undefined): string {
    if (!date) return 'N/A';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  }

  private formatCurrency(amount: number | undefined): string {
    const value = Number(amount) || 0;
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
