import { CareNoteType } from '../../../common/enums';

// Re-export AI metadata interface for convenience
export type { INoteAiMetadata } from './ai-metadata.interface';

/**
 * Note Content Interfaces
 * Strongly-typed content structures for different note types
 */

// ============================
// Base Interfaces
// ============================

/**
 * Base Note Structure
 * Common fields across all note types
 */
export interface IBaseNote {
  type: CareNoteType;
  title?: string;
  summary?: string;
  subjective?: string;
  objective?: string;
  assessment?:
    | string
    | {
        diagnosis?: string;
        differentialDiagnosis?: string[];
        treatmentPlan?: string;
        prescription?: ITreatmentStructure[];
        [key: string]: any;
      };
  additionalNotes?: string;
}

/**
 * Typed Note Utility Interface
 * Generic base that narrows `type` to a specific CareNoteType literal so
 * TypeScript can fully discriminate the INoteContent union.
 *
 * Usage:
 *   export interface IOperationNote extends ITypedNote<CareNoteType.OPERATION> { ... }
 *   export interface IOrthopedicsNote extends ITypedNote<CareNoteType.ORTHOPEDIC_OPERATION>, Omit<IOperationNote, 'type'> { ... }
 */
export interface ITypedNote<T extends CareNoteType> extends IBaseNote {
  type: T;
}

// ============================
// Note Type Interfaces
// ============================

/**
 * SOAP Note Structure
 * Standard Subjective, Objective, Assessment, Plan format
 */
export interface ISoapNote extends IBaseNote {
  type: CareNoteType.SOAP;
  subjective: string; // Chief complaint, symptoms
  objective: string; // Vital signs, physical exam
  assessment: string; // Diagnosis
  plan: string; // Treatment plan
}

/**
 * Progress Note Structure
 * Daily patient progress documentation
 */
export interface IProgressNote extends IBaseNote {
  type: CareNoteType.PROGRESS;
  intervalHistory: string;
  physicalExam: IPhysicalExam;
  assessmentAndPlan: string[];
}

/**
 * Admission Note Structure
 * Initial patient admission documentation
 */
export interface IAdmissionNote extends IBaseNote {
  type: CareNoteType.ADMISSION;
  admissionReason: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  allergies: string;
  medications: string;
  reviewOfSystems: IReviewOfSystems;
  physicalExam: IPhysicalExam;
  assessment: IAssessment;
}

/**
 * Consultation Note Structure
 * Specialist consultation documentation
 */
export interface IConsultationNote extends IBaseNote {
  type: CareNoteType.CONSULTATION;
  chiefComplaint: IChiefComplaint;
  historyOfPresentIllness: string;
  reviewOfSystems: IReviewOfSystems;
  physicalExam: IPhysicalExam;
  assessment: IAssessment;
}

/**
 * Procedure Note Structure
 * Medical procedure documentation
 */
export interface IProcedureNote extends IBaseNote {
  type: CareNoteType.PROCEDURE;
  procedureName: string;
  procedureCode?: string; // CPT code
  indications: string;
  description: string;
  findings: string;
  complications: string;
  postProcedureInstructions: string;

  // Additional details
  anesthesiaUsed?: string;
  estimatedBloodLoss?: string;
  specimensTaken?: string[];
  durationMinutes?: number;
  equipmentUsed?: string[];
  vitalSigns?: {
    preProcedure?: Record<string, string>;
    postProcedure?: Record<string, string>;
  };
  medicationsAdministered?: IMedicationAdministered[];
}

/**
 * Operation Note Structure
 * Surgical operation documentation.
 * Extends ITypedNote so that IOrthopedicsNote can omit 'type' and supply its
 * own narrowed type without re-declaring all operation fields.
 */
export interface IOperationNote extends ITypedNote<CareNoteType.OPERATION> {
  operationName: string;
  operationCode?: string;
  preoperativeDiagnosis: string;
  postoperativeDiagnosis: string;
  procedureDescription: string;
  findings: string;
  specimens: string[];
  estimatedBloodLoss: string;
  complications: string;

  surgicalTeam?: ISurgicalTeamMember[];
  anesthesiaType?: 'General' | 'Regional' | 'Local' | 'Sedation';
  anesthesiaDuration?: number; // minutes
  surgicalApproach?: 'Open' | 'Laparoscopic' | 'Robotic' | 'Endoscopic';
  drainsPlaced?: string;
  closureTechnique?: string;
  implantsUsed?: IImplant[];
}

/**
 * Orthopedics Operation Note Structure
 * Extends the standard operation note with orthopedic-specific fields
 * (implant tracking, tourniquet, reduction quality, rehab protocol, etc.).
 *
 * Using `Omit<IOperationNote, 'type'>` ensures all operation fields are
 * inherited while the discriminant `type` is overridden to
 * `CareNoteType.ORTHOPEDIC_OPERATION` via `ITypedNote`.
 */
export interface IOrthopedicsNote
  extends ITypedNote<CareNoteType.ORTHOPEDIC_OPERATION>,
    Omit<IOperationNote, 'type'> {
  /** Side of the body operated on */
  laterality: 'Left' | 'Right' | 'Bilateral';

  /** Surgical approach direction */
  approach?: 'Anterior' | 'Posterior' | 'Lateral' | 'Medial' | 'Combined';

  /** Detailed orthopedic implants (superset of base implantsUsed) */
  implants: Array<{
    type: 'Plate' | 'Screw' | 'Rod' | 'Prosthesis' | 'Cage' | 'Anchor';
    manufacturer: string;
    model: string;
    size?: string;
    lotNumber?: string;
    position?: string;
  }>;

  boneGraft?: {
    type: 'Autograft' | 'Allograft' | 'Synthetic';
    source?: string;
    volume?: string;
  };

  tourniquet?: {
    used: boolean;
    timeMinutes?: number;
    pressureMmHg?: number;
  };

  reductionQuality?: 'Anatomical' | 'Near-anatomical' | 'Acceptable' | 'Poor';

  rangeOfMotion?: {
    preOp?: Record<string, string>;
    postOp?: Record<string, string>;
  };

  antibioticRegimen?: {
    preoperative?: string;
    postoperative?: string;
  };

  rehabProtocol?: {
    /** Weight-bearing status: NWB=Non, PWB=Partial, WBAT=As Tolerated, FWB=Full */
    weightBearing: 'NWB' | 'PWB' | 'WBAT' | 'FWB';
    timeline?: string;
  };

  /** Number of fluoroscopy images taken intra-operatively */
  fluoroscopyShots?: number;

  /** Total C-arm exposure time in minutes */
  cArmTimeMinutes?: number;
}

/**
 * Discharge Note Structure
 * Patient discharge summary
 */
export interface IDischargeNote extends IBaseNote {
  type: CareNoteType.DISCHARGE;
  dischargeDiagnosis: string;
  hospitalCourse: string;
  dischargeMedications: string[];
  dischargeInstructions: string;
  followUpPlan: string;
}

/**
 * Emergency Note Structure
 * Emergency department documentation
 */
export interface IEmergencyNote extends IBaseNote {
  type: CareNoteType.EMERGENCY;
  chiefComplaint: IChiefComplaint;
  historyOfPresentIllness: string;
  physicalExam: IPhysicalExam;
  emergencyAssessment: string;
  emergencyPlan: string;
  triage?: {
    level: 'Critical' | 'Urgent' | 'Semi-urgent' | 'Non-urgent';
    vitalSigns: Record<string, string>;
  };
}

/**
 * Follow-up Note Structure
 * Post-visit follow-up documentation
 */
export interface IFollowUpNote extends IBaseNote {
  type: CareNoteType.FOLLOW_UP;
  intervalHistory: string;
  physicalExam: IPhysicalExam;
  assessmentAndPlan: string[];
  complianceNotes?: string;
}

/**
 * General Examination Note Structure
 * Comprehensive examination documentation
 */
export interface IGeneralExaminationNote extends IBaseNote {
  type: CareNoteType.GENERAL_EXAMINATION;

  // Patient Allergies and Medications
  drugAllergies?: IAllergyStructure[];
  medication?: ITreatmentStructure[];

  // History
  history?: string;

  // Examination/Vitals
  examination: {
    bloodPressure?: string;
    heartRate?: string;
    temperature?: string;
    gcs?: string; // Glasgow Coma Scale
    respiratoryRate?: string;
    oxygenSaturation?: string;
    bloodGlucose?: string;
    weight?: string;
    height?: string;
    caseExamination: string;
  };

  // Investigations
  investigations?: string;

  // Diagnosis
  diagnosis?: string;

  // Management Plan
  managementPlan: string;

  // Treatment/Prescriptions
  treatmentPrescriptions?: {
    items: ITreatmentStructure[];
    additionalInstructions?: string;
  };

  // Procedures performed
  procedures?: Array<{
    name: string;
    description?: string;
  }>;

  // Admission
  admittedTo?: string;

  // Referral
  requestDoctor?: string;
}

// ============================
// Supporting Interfaces
// ============================

/**
 * Chief Complaint Structure
 */
export interface IChiefComplaint {
  primary: string;
  duration: string;
  description: string;
  onset?: 'Sudden' | 'Gradual';
  severity?: number; // 1-10 scale
}

/**
 * Physical Examination Structure
 */
export interface IPhysicalExam {
  generalAppearance?: string;
  vitalSigns?: Record<string, string>;
  heent?: string; // Head, Eyes, Ears, Nose, Throat
  cardiovascular?: string;
  respiratory?: string;
  abdomen?: string;
  musculoskeletal?: string;
  neurological?: string;
  skin?: string;
  [key: string]: any; // Allow custom exam sections
}

/**
 * Review of Systems Structure
 */
export interface IReviewOfSystems {
  sections: Array<{
    id: string;
    label: string;
    items: Array<{
      id: string;
      label: string;
      checked: boolean;
      positive: boolean;
      notes?: string;
    }>;
  }>;
  additionalNotes?: string;
  reviewedAndNegative: boolean; // All other systems negative
}

/**
 * Assessment Structure
 */
export interface IAssessment {
  diagnosis?: string;
  differentialDiagnosis?: string[];
  treatmentPlan?: string;
  prescription?: ITreatmentStructure[];
  [key: string]: any;
}

/**
 * Treatment/Prescription Structure
 */
export interface ITreatmentStructure {
  medicine: string;
  dose: string;
  route: 'Oral' | 'IV' | 'IM' | 'SC' | 'Topical' | 'Inhaled' | 'Other';
  frequency: string; // e.g., "BID", "TID", "QID", "PRN"
  days: string | number;
  instructions?: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Allergy Structure
 */
export interface IAllergyStructure {
  substance: string;
  reaction: string;
  severity: 'Mild' | 'Moderate' | 'Severe' | 'Life-threatening';
  onset?: Date;
  notes?: string;
}

/**
 * Medication Administered Structure
 */
export interface IMedicationAdministered {
  name: string;
  dosage: string;
  route: string;
  time: string | Date;
  administeredBy?: string;
}

/**
 * Surgical Team Member Structure
 */
export interface ISurgicalTeamMember {
  role: 'Surgeon' | 'Assistant' | 'Anesthesiologist' | 'Nurse' | 'Scrub Tech';
  providerId: string;
  name?: string;
}

/**
 * Implant Structure
 */
export interface IImplant {
  name: string;
  type?: string;
  lotNumber?: string;
  manufacturer?: string;
  model?: string;
  size?: string;
}

// ============================
// Union Types
// ============================

/**
 * Note Content Union Type
 * Represents any valid note content structure.
 * TypeScript narrows the union via the discriminant `type` field.
 */
export type INoteContent =
  | ISoapNote
  | IProgressNote
  | IAdmissionNote
  | IConsultationNote
  | IProcedureNote
  | IOperationNote
  | IOrthopedicsNote
  | IDischargeNote
  | IEmergencyNote
  | IFollowUpNote
  | IGeneralExaminationNote;

/**
 * Generate Note Options
 */
export interface IGenerateNoteOptions {
  noteType?: CareNoteType;
  templateId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  language?: string;
}
