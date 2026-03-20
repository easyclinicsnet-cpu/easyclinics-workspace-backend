/**
 * Document Extraction Service
 *
 * Extracts plain text from uploaded documents (PDF, DOCX) or signals that
 * image-type files should be routed through AI vision instead.
 *
 * @layer Domain Service
 * @dependencies pdf-parse, mammoth (npm packages)
 */

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname } from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DocumentValidation {
  /** High-level document category. */
  type: 'pdf' | 'docx' | 'image';
  /** Original file extension (e.g. '.pdf'). */
  extension: string;
  /** File size in bytes. */
  sizeBytes: number;
}

export interface DocumentExtractionResult {
  /** Extracted plain text. */
  text: string;
  /** Document sub-type that was processed. */
  type: 'pdf' | 'docx';
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class DocumentExtractionService {
  private readonly logger = new Logger(DocumentExtractionService.name);

  // ── Supported extensions → document type ──────────────────────────────────
  private static readonly EXTENSION_MAP: Record<string, 'pdf' | 'docx' | 'image'> = {
    '.pdf':  'pdf',
    '.docx': 'docx',
    '.jpg':  'image',
    '.jpeg': 'image',
    '.png':  'image',
    '.gif':  'image',
    '.webp': 'image',
  };

  /** Maximum file size: 20 MB (same as existing image limit). */
  private static readonly MAX_FILE_SIZE = 20 * 1024 * 1024;

  // ── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validates the uploaded file exists, has a supported extension,
   * and does not exceed the size limit.
   *
   * @returns Metadata about the document (type, extension, size).
   * @throws BadRequestException on validation failure.
   */
  validateDocumentFile(filePath: string): DocumentValidation {
    if (!filePath || !existsSync(filePath)) {
      throw new BadRequestException('Document file not found');
    }

    const ext = extname(filePath).toLowerCase();
    const type = DocumentExtractionService.EXTENSION_MAP[ext];

    if (!type) {
      const allowed = Object.keys(DocumentExtractionService.EXTENSION_MAP).join(', ');
      throw new BadRequestException(
        `Unsupported document format '${ext}'. Allowed: ${allowed}`,
      );
    }

    const stat = statSync(filePath);
    if (stat.size === 0) {
      throw new BadRequestException('Document file is empty');
    }
    if (stat.size > DocumentExtractionService.MAX_FILE_SIZE) {
      const maxMB = DocumentExtractionService.MAX_FILE_SIZE / (1024 * 1024);
      throw new BadRequestException(
        `Document file exceeds the ${maxMB} MB size limit`,
      );
    }

    return { type, extension: ext, sizeBytes: stat.size };
  }

  // ── Extraction ─────────────────────────────────────────────────────────────

  /**
   * Extracts plain text from a PDF or DOCX file.
   *
   * For **image** files this returns `null` to signal the caller to route
   * through the existing AI vision pipeline instead.
   *
   * @returns Extracted text + type, or `null` for images.
   * @throws BadRequestException if the document contains no extractable text.
   */
  async extractText(filePath: string): Promise<DocumentExtractionResult | null> {
    const { type } = this.validateDocumentFile(filePath);

    switch (type) {
      case 'pdf':
        return { text: await this.extractFromPdf(filePath), type: 'pdf' };
      case 'docx':
        return { text: await this.extractFromDocx(filePath), type: 'docx' };
      case 'image':
        // Images need AI vision — caller handles this path.
        return null;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async extractFromPdf(filePath: string): Promise<string> {
    this.logger.log(`Extracting text from PDF: ${filePath}`);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse');
    const buffer = readFileSync(filePath);
    const result = await pdfParse(buffer);

    const text = result.text?.trim();
    if (!text) {
      throw new BadRequestException(
        'PDF contains no extractable text. If it is a scanned document, try uploading it as an image instead.',
      );
    }

    this.logger.log(
      `PDF extracted: ${result.numpages} page(s), ${text.length} chars`,
    );
    return text;
  }

  private async extractFromDocx(filePath: string): Promise<string> {
    this.logger.log(`Extracting text from DOCX: ${filePath}`);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });

    const text = result.value?.trim();
    if (!text) {
      throw new BadRequestException(
        'DOCX document contains no extractable text',
      );
    }

    if (result.messages?.length) {
      this.logger.warn(
        `DOCX extraction warnings: ${JSON.stringify(result.messages)}`,
      );
    }

    this.logger.log(`DOCX extracted: ${text.length} chars`);
    return text;
  }
}
