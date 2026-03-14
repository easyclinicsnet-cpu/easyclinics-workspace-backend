import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Transform } from 'class-transformer';
import { FamilyCondition } from '../../entities/family-condition.entity';

@Exclude()
export class FamilyConditionResponseDto {
  @ApiProperty({ description: 'Unique identifier' })
  @Expose()
  id!: string;

  @ApiProperty({ description: 'Relationship to patient' })
  @Expose()
  relationshipToPatient!: string;

  @ApiProperty({ description: 'Medical condition' })
  @Expose()
  condition!: string;

  @ApiPropertyOptional({ description: 'SNOMED CT code' })
  @Expose()
  snomedCode?: string;

  @ApiPropertyOptional({ description: 'Age of onset' })
  @Expose()
  ageOfOnset?: number;

  @ApiPropertyOptional({ description: 'Current age' })
  @Expose()
  currentAge?: number;

  @ApiPropertyOptional({ description: 'Is deceased' })
  @Expose()
  isDeceased?: boolean;

  @ApiPropertyOptional({ description: 'Cause of death' })
  @Expose()
  causeOfDeath?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @Expose()
  notes?: string;

  @ApiProperty({ description: 'Patient ID' })
  @Expose()
  patientId!: string;

  @ApiProperty({ description: 'Created date' })
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  createdAt!: Date;

  @ApiProperty({ description: 'Updated date' })
  @Expose()
  @Transform(({ value }) => (value ? value.toISOString() : null))
  updatedAt!: Date;

  static fromEntity(familyCondition: FamilyCondition): FamilyConditionResponseDto {
    const dto = new FamilyConditionResponseDto();

    // Extract metadata from notes field
    const metadata = FamilyConditionResponseDto.extractMetadata(familyCondition.notes);
    const plainNotes = FamilyConditionResponseDto.extractPlainNotes(familyCondition.notes);

    // Map the legacy 'relation' field to 'relationshipToPatient' and include metadata
    Object.assign(dto, {
      id: familyCondition.id,
      relationshipToPatient: familyCondition.relation,
      condition: familyCondition.condition,
      snomedCode: metadata.snomedCode,
      ageOfOnset: metadata.ageOfOnset,
      currentAge: metadata.currentAge,
      isDeceased: metadata.isDeceased,
      causeOfDeath: metadata.causeOfDeath,
      notes: plainNotes,
      patientId: familyCondition.patientId,
      createdAt: familyCondition.createdAt,
      updatedAt: familyCondition.updatedAt,
    });

    return dto;
  }

  /**
   * Extract metadata from notes field
   * @private
   */
  private static extractMetadata(notes?: string): any {
    if (!notes) return {};

    const metadataMatch = notes.match(/\[METADATA\](.*?)\[\/METADATA\]/s);
    if (metadataMatch && metadataMatch[1]) {
      try {
        return JSON.parse(metadataMatch[1]);
      } catch (error) {
        return {};
      }
    }

    return {};
  }

  /**
   * Extract plain notes without metadata
   * @private
   */
  private static extractPlainNotes(notes?: string): string {
    if (!notes) return '';

    return notes.replace(/\[METADATA\].*?\[\/METADATA\]/s, '').trim();
  }
}
