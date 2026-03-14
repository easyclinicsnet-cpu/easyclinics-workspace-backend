import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PatientResponseDto } from './patient-response.dto';

/**
 * Patient With Details Response DTO
 * Extended patient response that includes all related clinical information
 *
 * Features:
 * - Extends PatientResponseDto (includes all base patient data)
 * - Includes all patient-related clinical data:
 *   - Allergies
 *   - Vital signs
 *   - Current medications
 *   - Family medical conditions
 *   - Social history
 *   - Past medical history
 *   - Past surgical history
 *
 * Use cases:
 * - Patient detail view
 * - Clinical consultation view
 * - Comprehensive patient profile
 * - Patient chart/EMR view
 *
 * Note: Related DTOs are placeholders - they should be defined in their respective subdirectories
 */
export class PatientWithDetailsResponseDto extends PatientResponseDto {
  // ===== CLINICAL INFORMATION (PLACEHOLDER TYPES) =====
  // These types should be imported from their respective DTO files once created

  @ApiPropertyOptional({
    description: 'Patient allergies',
    type: 'array',
    isArray: true,
  })
  @Type(() => Object) // TODO: Replace with AllergyResponseDto when available
  allergies?: any[];

  @ApiPropertyOptional({
    description: 'Patient vital signs history',
    type: 'array',
    isArray: true,
  })
  @Type(() => Object) // TODO: Replace with VitalResponseDto when available
  vitals?: any[];

  @ApiPropertyOptional({
    description: 'Patient current medications',
    type: 'array',
    isArray: true,
  })
  @Type(() => Object) // TODO: Replace with CurrentMedicationResponseDto when available
  currentMedications?: any[];

  @ApiPropertyOptional({
    description: 'Family medical conditions',
    type: 'array',
    isArray: true,
  })
  @Type(() => Object) // TODO: Replace with FamilyConditionResponseDto when available
  familyConditions?: any[];

  @ApiPropertyOptional({
    description: 'Patient social history',
    type: 'array',
    isArray: true,
  })
  @Type(() => Object) // TODO: Replace with SocialHistoryResponseDto when available
  socialHistories?: any[];

  @ApiPropertyOptional({
    description: 'Past medical history',
    type: 'array',
    isArray: true,
  })
  @Type(() => Object) // TODO: Replace with PastMedicalHistoryResponseDto when available
  medicalHistory?: any[];

  @ApiPropertyOptional({
    description: 'Past surgical history',
    type: 'array',
    isArray: true,
  })
  @Type(() => Object) // TODO: Replace with PastSurgicalHistoryResponseDto when available
  surgicalHistory?: any[];

  /**
   * Create PatientWithDetailsResponseDto from Patient entity with relationships
   *
   * @param patient - Patient entity with loaded relationships
   * @returns Formatted PatientWithDetailsResponseDto
   */
  static fromEntityWithDetails(patient: any): PatientWithDetailsResponseDto {
    // Start with base patient data
    const dto = Object.assign(
      new PatientWithDetailsResponseDto(),
      PatientResponseDto.fromEntity(patient),
    );

    // Add relationships if they exist
    // Note: These should be transformed using their respective fromEntity methods
    // once the related DTOs are properly defined

    if (patient.allergies) {
      dto.allergies = patient.allergies;
      // TODO: dto.allergies = patient.allergies.map(a => AllergyResponseDto.fromEntity(a));
    }

    if (patient.vitals) {
      dto.vitals = patient.vitals;
      // TODO: dto.vitals = patient.vitals.map(v => VitalResponseDto.fromEntity(v));
    }

    if (patient.currentMedications) {
      dto.currentMedications = patient.currentMedications;
      // TODO: dto.currentMedications = patient.currentMedications.map(m => CurrentMedicationResponseDto.fromEntity(m));
    }

    if (patient.familyConditions) {
      dto.familyConditions = patient.familyConditions;
      // TODO: dto.familyConditions = patient.familyConditions.map(f => FamilyConditionResponseDto.fromEntity(f));
    }

    if (patient.socialHistories) {
      dto.socialHistories = patient.socialHistories;
      // TODO: dto.socialHistories = patient.socialHistories.map(s => SocialHistoryResponseDto.fromEntity(s));
    }

    if (patient.medicalHistory) {
      dto.medicalHistory = patient.medicalHistory;
      // TODO: dto.medicalHistory = patient.medicalHistory.map(h => PastMedicalHistoryResponseDto.fromEntity(h));
    }

    if (patient.surgicalHistory) {
      dto.surgicalHistory = patient.surgicalHistory;
      // TODO: dto.surgicalHistory = patient.surgicalHistory.map(h => PastSurgicalHistoryResponseDto.fromEntity(h));
    }

    return dto;
  }
}
