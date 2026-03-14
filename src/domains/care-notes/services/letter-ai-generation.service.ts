// openai-letter-strategy.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AIProvider, ReferralType, ReferralUrgency, WorkRestrictionType } from '../../../common/enums';
import { LoggerService } from '../../../common/logger/logger.service';

interface PatientInfo {
  fullName: string;
  age: string;
  gender: string;
  fileNumber?: string;
  dateOfBirth: string;
}

interface ReferralGenerationContext {
  patient: PatientInfo;
  comprehensivePatientHistory: string;
  comprehensiveTranscript: string;
  clinicalSummary: string;
  examinationFindings: string;
  investigationResults?: string;
  treatmentToDate: string;
  reasonForReferral: string;
  referralType: ReferralType;
  urgency: ReferralUrgency;
  referredToService: string;
  referredToClinician?: string;
  referredToFacility: string;
  facilityAddress?: string;
  facilityContact?: string;
  specificQuestions?: string;
  requiresAppointment: boolean;
  preferredAppointmentDate?: Date;
  specialInstructions?: string;
  insuranceAuthorization?: string;
}

interface SickNoteGenerationContext {
  patient: PatientInfo;
  comprehensivePatientHistory: string;
  comprehensiveTranscript: string;
  diagnosis: string;
  icd10Code?: string;
  clinicalSummary: string;
  relevantFindings?: string;
  startDate: string;
  endDate: string;
  workRestriction: WorkRestrictionType;
  specificRestrictions?: string;
  accommodations?: string;
  requiresFollowUp: boolean;
  followUpDate?: string;
  followUpInstructions?: string;
  isHospitalized: boolean;
  expectedReturnDate?: string;
}

interface ExtensionGenerationContext {
  patient: PatientInfo;
  comprehensivePatientHistory: string;
  comprehensiveTranscript: string;
  originalDiagnosis: string;
  originalIcd10Code?: string;
  originalClinicalSummary?: string;
  originalRelevantFindings?: string;
  originalStartDate: string;
  originalEndDate: string;
  workRestriction: WorkRestrictionType;
  specificRestrictions?: string;
  accommodations?: string;
  requiresFollowUp?: boolean;
  followUpDate?: string;
  followUpInstructions?: string;
  isHospitalized?: boolean;
  expectedReturnDate?: string;
  newEndDate: string;
  extensionReason?: string;
}

interface LetterGenerationResult {
  finalLetter: string;
  structuredContent?: {
    clinicalHistory: string;
    examinationSummary: string;
    managementRationale: string;
  };
  metadata: {
    tokensUsed: number;
    model: string;
    generationTime: number;
    extensionReason?: string;
  };
}

@Injectable()
export class LetterAiGenerationService {
  private openai: OpenAI;

  // Optimized models for different letter types
  private readonly letterModels = {
    referral: 'gpt-4o', // More structured, formal documents
    sickNote: 'gpt-4o', // Concise, professional notes
    extension: 'gpt-4o', // Quick, reference-based generation
  };

  private readonly defaultTemperature = 0.1; // Low temperature for consistent medical documents
  private readonly maxTokens = {
    referral: 4000, // Increased for comprehensive data
    sickNote: 3000, // Increased for comprehensive data
    extension: 1500,
  };

  constructor(private configService: ConfigService, private readonly logger: LoggerService) {
    this.logger.setContext('LetterAiGenerationService');
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      timeout: 45000, // Increased timeout for comprehensive generation
      maxRetries: 3,
    });
  }

  /**
   * Generate a professional referral letter with comprehensive patient data
   */
  async generateReferralLetter(
    context: ReferralGenerationContext,
  ): Promise<LetterGenerationResult> {
    const operationId = `referral_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.log(`[${operationId}] Starting referral letter generation`, {
        patient: context.patient.fullName,
        referralType: context.referralType,
        urgency: context.urgency,
      });

      const prompt = this.buildReferralLetterPrompt(context);
      const model = this.letterModels.referral;

      this.logger.debug(`[${operationId}] Sending request to OpenAI`, {
        model,
        transcriptLength: context.comprehensiveTranscript.length,
        patientHistoryLength: context.comprehensivePatientHistory.length,
      });

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: this.getReferralSystemPrompt(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: this.maxTokens.referral,
        temperature: this.defaultTemperature,
        response_format: { type: 'json_object' },
      });

      const generationTime = Date.now() - startTime;
      const result = this.parseLetterResponse(response, 'referral');

      this.logger.log(
        `[${operationId}] Referral letter generated successfully`,
        {
          patient: context.patient.fullName,
          tokensUsed: result.metadata.tokensUsed,
          generationTime: `${generationTime}ms`,
          transcriptSections: this.countTranscriptSections(
            context.comprehensiveTranscript,
          ),
        },
      );

      return {
        ...result,
        metadata: {
          ...result.metadata,
          generationTime,
        },
      };
    } catch (error) {
      this.logger.error(`[${operationId}] Referral letter generation failed`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        operationId,
        patient: context.patient.fullName,
      });
      throw this.handleGenerationError(error, 'referral');
    }
  }

  /**
   * Generate a professional sick note with comprehensive patient data
   */
  async generateSickNote(
    context: SickNoteGenerationContext,
  ): Promise<LetterGenerationResult> {
    const operationId = `sicknote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.log(`[${operationId}] Starting sick note generation`, {
        patient: context.patient.fullName,
        diagnosis: context.diagnosis,
        duration: `${context.startDate} to ${context.endDate}`,
      });

      const prompt = this.buildSickNotePrompt(context);
      const model = this.letterModels.sickNote;

      this.logger.debug(
        `[${operationId}] Sending comprehensive sick note request`,
        {
          model,
          transcriptLength: context.comprehensiveTranscript.length,
          patientHistoryLength: context.comprehensivePatientHistory.length,
        },
      );

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: this.getSickNoteSystemPrompt(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: this.maxTokens.sickNote,
        temperature: this.defaultTemperature,
        response_format: { type: 'json_object' },
      });

      const generationTime = Date.now() - startTime;
      const result = this.parseLetterResponse(response, 'sickNote');

      this.logger.log(`[${operationId}] Sick note generated successfully`, {
        patient: context.patient.fullName,
        tokensUsed: result.metadata.tokensUsed,
        generationTime: `${generationTime}ms`,
        transcriptSections: this.countTranscriptSections(
          context.comprehensiveTranscript,
        ),
      });

      return {
        ...result,
        metadata: {
          ...result.metadata,
          generationTime,
        },
      };
    } catch (error) {
      this.logger.error(`[${operationId}] Sick note generation failed`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        operationId,
        patient: context.patient.fullName,
      });
      throw this.handleGenerationError(error, 'sickNote');
    }
  }

  /**
   * Generate a sick note extension with comprehensive patient data
   */
  async generateSickNoteExtension(
    context: ExtensionGenerationContext,
  ): Promise<LetterGenerationResult> {
    const operationId = `extension_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      this.logger.log(
        `[${operationId}] Starting sick note extension generation`,
        {
          patient: context.patient.fullName,
          originalEndDate: context.originalEndDate,
          newEndDate: context.newEndDate,
        },
      );

      const prompt = this.buildExtensionPrompt(context);
      const model = this.letterModels.extension;

      this.logger.debug(`[${operationId}] Sending extension request`, {
        model,
        transcriptLength: context.comprehensiveTranscript.length,
      });

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: this.getExtensionSystemPrompt(),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: this.maxTokens.extension,
        temperature: this.defaultTemperature,
        response_format: { type: 'json_object' },
      });

      const generationTime = Date.now() - startTime;
      const result = this.parseLetterResponse(response, 'extension');

      this.logger.log(
        `[${operationId}] Sick note extension generated successfully`,
        {
          patient: context.patient.fullName,
          tokensUsed: result.metadata.tokensUsed,
          generationTime: `${generationTime}ms`,
          extensionDuration: this.calculateExtensionDuration(
            context.originalEndDate,
            context.newEndDate,
          ),
        },
      );

      return {
        ...result,
        metadata: {
          ...result.metadata,
          generationTime,
          extensionReason:
            context.extensionReason ||
            'Medical condition requires ongoing care',
        },
      };
    } catch (error) {
      this.logger.error(
        `[${operationId}] Sick note extension generation failed`,
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          operationId,
          patient: context.patient.fullName,
          originalEndDate: context.originalEndDate,
          newEndDate: context.newEndDate,
        },
      );
      throw this.handleGenerationError(error, 'extension');
    }
  }

  /**
   * Batch generate multiple letters (optimized for efficiency)
   */
  async batchGenerateLetters(
    requests: {
      type: 'referral' | 'sickNote';
      context: ReferralGenerationContext | SickNoteGenerationContext;
    }[],
  ): Promise<LetterGenerationResult[]> {
    const operationId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.logger.log(`[${operationId}] Starting batch letter generation`, {
      count: requests.length,
      types: requests.map((r) => r.type),
    });

    // Process in parallel with concurrency control
    const batchSize = 2; // Reduced for comprehensive data processing
    const results: LetterGenerationResult[] = [];

    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);

      const batchPromises = batch.map((request) => {
        if (request.type === 'referral') {
          return this.generateReferralLetter(
            request.context as ReferralGenerationContext,
          );
        } else {
          return this.generateSickNote(
            request.context as SickNoteGenerationContext,
          );
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);

      // Process batch results
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          this.logger.error(`[${operationId}] Batch item failed`, {
            index: i + index,
            error: result.reason.message,
          });
          results.push(this.createFallbackLetter(batch[index].type));
        }
      });

      // Longer pause between batches for comprehensive processing
      if (i + batchSize < requests.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    this.logger.log(`[${operationId}] Batch generation completed`, {
      successful: results.filter((r) => !r.finalLetter.includes('FALLBACK'))
        .length,
      total: requests.length,
    });

    return results;
  }

  /**
   * Health check specifically for letter generation
   */
  async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
    const operationId = `health_letters_${Date.now()}`;

    try {
      // Test with a simple completion to verify letter generation capability
      const testResponse = await this.openai.chat.completions.create({
        model: this.letterModels.referral,
        messages: [
          {
            role: 'user',
            content:
              'Generate a test medical letter. Respond with {"status": "ok"}',
          },
        ],
        max_tokens: 10,
      });

      const content = testResponse.choices[0]?.message?.content;
      const healthy = !!(content && content.includes('"status": "ok"'));

      return {
        healthy,
        details: healthy
          ? 'Letter generation service operational'
          : 'Unexpected test response',
      };
    } catch (error) {
      return {
        healthy: false,
        details: `Letter generation health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // PROMPT BUILDING METHODS

  private buildReferralLetterPrompt(
    context: ReferralGenerationContext,
  ): string {
    const urgencyDisplay = this.getUrgencyDisplay(context.urgency);
    const typeDisplay = this.getReferralTypeDisplay(context.referralType);

    return `
GENERATE PROFESSIONAL REFERRAL LETTER
- NB. Never put asterisk on and sub section or sub headings e.g **Examination Summary:** is not acceptible.

COMPREHENSIVE PATIENT HISTORY:
${context.comprehensivePatientHistory}

CONSULTATION TRANSCRIPTS:
${context.comprehensiveTranscript}

REFERRAL DETAILS:
- Type: ${typeDisplay}
- Urgency: ${urgencyDisplay}
- Service: ${context.referredToService}
- Referring to ${context.referredToClinician ? `- Clinician: ${context.referredToClinician}` : ''}
- Facility: ${context.referredToFacility}
${context.facilityAddress ? `- Facility Address: ${context.facilityAddress}` : ''}
${context.facilityContact ? `- Facility Contact: ${context.facilityContact}` : ''}

CLINICAL INFORMATION:
- Clinical Summary: ${context.clinicalSummary}
- Examination Findings: ${context.examinationFindings}
${context.investigationResults ? `- Investigation Results: ${context.investigationResults}` : ''}
- Treatment to Date: ${context.treatmentToDate}
- Reason for Referral: ${context.reasonForReferral}
${context.specificQuestions ? `- Specific Questions: ${context.specificQuestions}` : ''}

LOGISTICAL INFORMATION:
- Requires Appointment: ${context.requiresAppointment ? 'Yes' : 'No'}
${context.preferredAppointmentDate ? `- Preferred Appointment: ${context.preferredAppointmentDate.toDateString()}` : ''}
${context.specialInstructions ? `- Special Instructions: ${context.specialInstructions}` : ''}
${context.insuranceAuthorization ? `- Insurance Authorization: ${context.insuranceAuthorization}` : ''}

Generate a comprehensive, professionally formatted referral letter that incorporates:
1. Relevant patient medical history from the comprehensive profile
2. Key clinical insights from the consultation transcripts
3. Clear referral rationale based on the clinical presentation
4. Specific requests for the receiving specialist/service
5. Appropriate urgency level indication
6. All necessary logistical details
7. Never put asterisk on and sub section or sub headings e.g **Examination Summary:** is not acceptible.

Ensure the letter is well-structured, professionally formatted, and facilitates optimal patient care coordination.

Return JSON: { "finalLetter": "formatted letter content", "structuredContent": { "clinicalHistory": "...", "examinationSummary": "...", "managementRationale": "..." } }
    `;
  }

  private buildSickNotePrompt(context: SickNoteGenerationContext): string {
    const restrictionDisplay = this.getRestrictionDisplay(
      context.workRestriction,
    );
    const durationDays = this.calculateDuration(
      context.startDate,
      context.endDate,
    );

    return `
GENERATE PROFESSIONAL SICK NOTE

COMPREHENSIVE PATIENT HISTORY:
${context.comprehensivePatientHistory}

CONSULTATION TRANSCRIPTS:
${context.comprehensiveTranscript}

MEDICAL INFORMATION:
- Diagnosis: ${context.diagnosis}
${context.icd10Code ? `- ICD-10 Code: ${context.icd10Code}` : ''}
- Clinical Summary: ${context.clinicalSummary}
${context.relevantFindings ? `- Relevant Findings: ${context.relevantFindings}` : ''}

WORK CAPACITY ASSESSMENT:
- Work Restriction: ${restrictionDisplay}
${context.specificRestrictions ? `- Specific Restrictions: ${context.specificRestrictions}` : ''}
${context.accommodations ? `- Accommodations Required: ${context.accommodations}` : ''}
- Duration: ${context.startDate} to ${context.endDate} (${durationDays} days)
- Hospitalized: ${context.isHospitalized ? 'Yes' : 'No'}
${context.expectedReturnDate ? `- Expected Return: ${context.expectedReturnDate}` : ''}

FOLLOW-UP:
- Requires Follow-up: ${context.requiresFollowUp ? 'Yes' : 'No'}
${context.followUpDate ? `- Follow-up Date: ${context.followUpDate}` : ''}
${context.followUpInstructions ? `- Follow-up Instructions: ${context.followUpInstructions}` : ''}

Generate a professional sick note that incorporates:
1. Relevant patient history that supports the current condition
2. Key clinical findings from the consultation
3. Clear medical justification for work restrictions
4. Specific accommodation requirements if applicable
5. Appropriate follow-up planning
6. Professional certification format suitable for employers
7. Never put asterisk on and sub section or sub headings e.g **Examination Summary:** is not acceptible.

The note should be authoritative, medically sound, and provide clear guidance to employers while maintaining patient confidentiality.

Return JSON: { "finalLetter": "formatted note content", "structuredContent": { "clinicalHistory": "...", "examinationSummary": "...", "managementRationale": "..." } }
    `;
  }

  private buildExtensionPrompt(context: ExtensionGenerationContext): string {
    const originalDuration = this.calculateDuration(
      context.originalStartDate,
      context.originalEndDate,
    );
    const extensionDuration = this.calculateExtensionDuration(
      context.originalEndDate,
      context.newEndDate,
    );

    return `
GENERATE SICK NOTE EXTENSION

COMPREHENSIVE PATIENT HISTORY:
${context.comprehensivePatientHistory}

CONSULTATION TRANSCRIPTS:
${context.comprehensiveTranscript}

ORIGINAL SICK NOTE:
- Patient: ${context.patient.fullName}
- Original Diagnosis: ${context.originalDiagnosis}
${context.originalIcd10Code ? `- ICD-10 Code: ${context.originalIcd10Code}` : ''}
- Original Period: ${context.originalStartDate} to ${context.originalEndDate} (${originalDuration} days)
- Work Restriction: ${this.getRestrictionDisplay(context.workRestriction)}
${context.specificRestrictions ? `- Specific Restrictions: ${context.specificRestrictions}` : ''}
${context.accommodations ? `- Accommodations: ${context.accommodations}` : ''}

EXTENSION REQUEST:
- New End Date: ${context.newEndDate}
- Extension Period: ${context.originalEndDate} to ${context.newEndDate} (${extensionDuration} days)
- Reason for Extension: ${context.extensionReason || 'Continuation of medical condition requiring ongoing work restriction'}
${context.requiresFollowUp ? `- Follow-up Required: Yes` : ''}
${context.followUpDate ? `- Follow-up Date: ${context.followUpDate}` : ''}

Generate a professional sick note extension that:
1. Clearly references the original sick note and its details
2. Incorporates relevant patient history and consultation context
3. Provides medical justification for the extension
4. Maintains consistency with original restrictions and accommodations
5. Clearly states the new extended period
6. Uses professional medical certification format
7. Never put asterisk on and sub section or sub headings e.g **Examination Summary:** is not acceptible.

The extension should be concise yet comprehensive, providing employers with clear understanding of the continued medical necessity.

Return JSON: { "finalLetter": "formatted extension content" }
    `;
  }

  // SYSTEM PROMPTS
  private getReferralSystemPrompt(): string {
    return `You are an AI medical assistant designed to assist doctors in generating professional referral letters on their behalf.
    Your task is to create comprehensive, well-structured referral letters that facilitate optimal patient care coordination.

    CRITICAL REQUIREMENTS:
    1. Use formal medical language and professional tone throughout
    2. Incorporate relevant patient history and consultation insights appropriately
    3. Structure the letter with clear clinical reasoning and specific referral requests
    4. Specify urgency level based on clinical context
    5. Maintain patient confidentiality while providing necessary clinical details
    6. Use proper business letter format with appropriate sections
    7. Include placeholders for doctor signature, practice stamp, and contact information
    8. Ensure clinical accuracy and coherence based on all provided information
    7. Never put asterisk on and sub section or sub headings e.g **Examination Summary:** is not acceptible.

    CONTEXT INTEGRATION:
    - Use the comprehensive patient history to provide relevant background
    - Incorporate key insights from consultation transcripts to support referral rationale
    - Ensure all clinical information is consistent and medically sound

    FORMAT REQUIREMENTS:
    - Start with professional letterhead indication
    - Include date, recipient addresses, and formal salutation
    - Use clear paragraph structure with logical flow
    - End with professional closing and signature lines
    - Return valid JSON with finalLetter and structuredContent fields
    - Never put asterisk on and sub section or sub headings e.g **Examination Summary:** is not acceptible.

    The referral letter should be comprehensive enough to facilitate appropriate care while being concise and professionally formatted.`;
  }

  private getSickNoteSystemPrompt(): string {
    return `You are an AI medical assistant designed to assist doctors in generating professional sick notes on their behalf.
    Your task is to create clear, authoritative medical certificates for work absence that are medically sound and employer-appropriate.

    CRITICAL REQUIREMENTS:
    1. Use authoritative medical language that establishes professional credibility
    2. Be specific and precise about work restrictions and their duration
    3. Maintain strict patient confidentiality - DO NOT disclose specific medical conditions, diagnoses, or symptoms
    4. Use professional medical justification without revealing sensitive health information
    5. Maintain professional certification tone throughout
    6. Provide clear, actionable instructions for employers
    7. Include placeholders for doctor signature, license number, and practice details
    8. Ensure compliance with medical certification standards and legal requirements
    7. Never put asterisk on and sub section or sub headings e.g **Examination Summary:** is not acceptible.

    CONFIDENTIALITY PROTECTION:
    - NEVER mention specific medical conditions, diagnoses, treatments, or symptoms
    - Use broad medical categories when necessary (e.g., "medical condition" instead of specific illness)
    - Focus on functional limitations and work capacity rather than medical details
    - Do not reference patient history, consultations, or examination findings that could reveal sensitive information
    - Use standardized medical certification language that protects privacy

    JUSTIFICATION FRAMEWORK:
    - State that the absence is "medically necessary" based on professional assessment
    - Emphasize that the certification follows medical evaluation and standards
    - Reference "health-related reasons" or "medical reasons" without specification
    - Use professional authority to validate the need for absence
    - Focus on the employee's ability to perform work duties safely

    FORMAT REQUIREMENTS:
    - Use official medical certificate format
    - Include clear patient identification (name only)
    - Specify exact dates of absence and work restrictions
    - Describe functional limitations and accommodations precisely
    - Include medical authority statements and certification
    - Return valid JSON with finalLetter and structuredContent fields
    - Never put asterisk on and sub section or sub headings e.g **Examination Summary:** is not acceptible.

    The sick note should be professional, authoritative, and provide employers with necessary work-related guidance while strictly maintaining patient medical confidentiality.`;
  }

  private getExtensionSystemPrompt(): string {
    return `You are an AI medical assistant designed to assist doctors in write sick notes on their behalf.
    Your task is to create concise yet comprehensive extensions that reference original notes while providing continued medical certification.

    CRITICAL REQUIREMENTS:
    1. Clearly reference the original sick note, diagnosis, and restrictions
    2. Maintain perfect consistency with original work restrictions and accommodations
    3. Provide appropriate medical justification for the extension
    4. Use concise, professional medical language
    5. Specify new end date prominently and clearly
    6. Incorporate relevant patient history and consultation context when appropriate
    7. Include necessary medical authority elements and certification statements
    8. Never put asterisk on and sub section or sub headings e.g **Examination Summary:** is not acceptible. 

    CONTEXT INTEGRATION:
    - Reference original note details accurately
    - Use patient history to support extension rationale when relevant
    - Maintain clinical consistency throughout

    FORMAT REQUIREMENTS:
    - Clearly reference original note and dates
    - Prominently state extension period
    - Maintain original work restrictions and accommodations
    - Use extension-specific professional format
    - Include medical certification elements
    - Return valid JSON with finalLetter field

    The extension should be professionally formatted, medically justified, and provide clear continuity from the original sick note.`;
  }

  // HELPER METHODS
  private parseLetterResponse(
    response: OpenAI.Chat.Completions.ChatCompletion,
    type: 'referral' | 'sickNote' | 'extension',
  ): LetterGenerationResult {
    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    try {
      const parsed = JSON.parse(content);

      if (!parsed.finalLetter) {
        throw new Error('Missing finalLetter in response');
      }

      return {
        finalLetter: parsed.finalLetter,
        structuredContent: parsed.structuredContent,
        metadata: {
          tokensUsed: response.usage?.total_tokens || 0,
          model: response.model,
          generationTime: 0, // Will be set by caller
        },
      };
    } catch (error) {
      this.logger.warn('Failed to parse JSON response, using raw content', {
        error: error instanceof Error ? error.message : 'Unknown error',
        content: content.substring(0, 200),
      });

      // Fallback: wrap raw content
      return {
        finalLetter: content,
        metadata: {
          tokensUsed: response.usage?.total_tokens || 0,
          model: response.model,
          generationTime: 0,
        },
      };
    }
  }

  private handleGenerationError(error: any, type: string): Error {
    if (error instanceof OpenAI.APIError) {
      switch (error.status) {
        case 401:
          return new Error('OpenAI API authentication failed');
        case 429:
          return new Error('Rate limit exceeded for letter generation');
        case 500:
          return new Error('OpenAI server error during letter generation');
        case 503:
          return new Error('OpenAI service unavailable for letter generation');
        default:
          return new Error(
            `OpenAI API error (${error.status}): ${error.message}`,
          );
      }
    }

    return new Error(`Letter generation failed: ${error.message}`);
  }

  private createFallbackLetter(
    type: 'referral' | 'sickNote',
  ): LetterGenerationResult {
    const baseContent =
      type === 'referral'
        ? 'REFERRAL LETTER UNAVAILABLE - Please contact healthcare provider.'
        : 'SICK NOTE UNAVAILABLE - Please contact healthcare provider.';

    return {
      finalLetter: `FALLBACK: ${baseContent}`,
      metadata: {
        tokensUsed: 0,
        model: 'fallback',
        generationTime: 0,
      },
    };
  }

  private getUrgencyDisplay(urgency: ReferralUrgency): string {
    const urgencyMap = {
      [ReferralUrgency.ROUTINE]: 'Routine',
      [ReferralUrgency.URGENT]: 'Urgent',
      [ReferralUrgency.EMERGENCY]: 'Emergency',
    };
    return urgencyMap[urgency] || 'Routine';
  }

  private getReferralTypeDisplay(type: ReferralType): string {
    const typeMap = {
      [ReferralType.SPECIALIST]: 'Specialist Consultation',
      [ReferralType.DIAGNOSTIC]: 'Diagnostic Investigation',
      [ReferralType.THERAPY]: 'Therapeutic Service',
      [ReferralType.SURGICAL]: 'Surgical Opinion',
      [ReferralType.OTHER]: 'Other Service',
    };
    return typeMap[type] || 'Medical Service';
  }

  private getRestrictionDisplay(restriction: WorkRestrictionType): string {
    const restrictionMap = {
      [WorkRestrictionType.FULL_REST]: 'Complete Work Restriction',
      [WorkRestrictionType.LIGHT_DUTY]: 'Light Duties Only',
      [WorkRestrictionType.MODIFIED_DUTY]: 'Modified Duties',
      [WorkRestrictionType.NO_RESTRICTION]: 'No Restrictions',
      [WorkRestrictionType.HOSPITALIZATION]: 'Hospitalized - Complete Rest',
    };
    return restrictionMap[restriction] || 'Medical Restriction';
  }

  private calculateDuration(startDate: string, endDate: string): number {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    } catch {
      return 0;
    }
  }

  private calculateExtensionDuration(
    originalEndDate: string,
    newEndDate: string,
  ): string {
    try {
      const originalEnd = new Date(originalEndDate);
      const newEnd = new Date(newEndDate);

      if (isNaN(originalEnd.getTime()) || isNaN(newEnd.getTime())) {
        return 'Duration calculation unavailable';
      }

      const diffTime = Math.abs(newEnd.getTime() - originalEnd.getTime());
      const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return `${days} day${days !== 1 ? 's' : ''}`;
    } catch {
      return 'Duration calculation unavailable';
    }
  }

  private countTranscriptSections(transcript: string): number {
    if (!transcript) return 0;
    return (transcript.match(/--- Consultation Transcript/g) || []).length;
  }

  // IAiGenerationStrategy Implementation
  getProvider(): AIProvider {
    return AIProvider.OPENAI;
  }
}
