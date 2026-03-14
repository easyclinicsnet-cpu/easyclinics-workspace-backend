import { Injectable } from '@nestjs/common';
import { AllergiesService } from './allergies.service';
import { SocialHistoryService } from './social-history.service';
import { MedicalHistoryService } from './medical-history.service';
import { SurgicalHistoryService } from './surgical-history.service';
import { FamilyConditionsService } from './family-conditions.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

/**
 * PatientHistoryService - Consolidated Facade
 *
 * Provides a unified interface for managing all patient history types:
 * - Allergies and intolerances
 * - Social history (smoking, alcohol, drugs, occupation)
 * - Past medical history (conditions and diagnoses)
 * - Past surgical history (procedures and complications)
 * - Family medical history (hereditary conditions and genetic risks)
 *
 * This facade pattern allows clients to interact with a single service
 * while maintaining separation of concerns at the implementation level.
 *
 * Multi-Tenancy: All methods require workspaceId
 * HIPAA: All operations are audited via underlying services and at composite level
 * Standards: Supports ICD-10, CPT, SNOMED CT, HL7 FHIR
 */
@Injectable()
export class PatientHistoryService {
  constructor(
    private readonly allergiesService: AllergiesService,
    private readonly socialHistoryService: SocialHistoryService,
    private readonly medicalHistoryService: MedicalHistoryService,
    private readonly surgicalHistoryService: SurgicalHistoryService,
    private readonly familyConditionsService: FamilyConditionsService,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('PatientHistoryService');
  }

  // ==================== ALLERGIES ====================

  /**
   * Create a new allergy record
   */
  async createAllergy(dto: any, userId: string, workspaceId: string) {
    return this.allergiesService.create(dto, userId, workspaceId);
  }

  /**
   * Get all allergies with filters
   */
  async findAllAllergies(query: any, workspaceId: string) {
    return this.allergiesService.findAll(query, workspaceId);
  }

  /**
   * Get allergies for a specific patient
   */
  async findPatientAllergies(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.allergiesService.findByPatient(patientId, workspaceId, page, limit);
  }

  /**
   * Get a single allergy record
   */
  async findOneAllergy(id: string, workspaceId: string) {
    return this.allergiesService.findOne(id, workspaceId);
  }

  /**
   * Update an allergy record
   */
  async updateAllergy(id: string, dto: any, userId: string, workspaceId: string) {
    return this.allergiesService.update(id, dto, userId, workspaceId);
  }

  /**
   * Delete an allergy record (soft delete)
   */
  async removeAllergy(id: string, userId: string, workspaceId: string) {
    return this.allergiesService.remove(id, userId, workspaceId);
  }

  /**
   * Find allergies by severity
   */
  async findAllergiesBySeverity(
    severity: any,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.allergiesService.findBySeverity(severity, workspaceId, page, limit);
  }

  // ==================== SOCIAL HISTORY ====================

  /**
   * Create or update social history for a patient
   */
  async createSocialHistory(dto: any, userId: string, workspaceId: string) {
    return this.socialHistoryService.create(dto, userId, workspaceId);
  }

  /**
   * Get social history for a patient
   */
  async findPatientSocialHistory(patientId: string, workspaceId: string) {
    return this.socialHistoryService.findByPatient(patientId, workspaceId);
  }

  /**
   * Get a single social history record by ID
   */
  async findOneSocialHistory(id: string, workspaceId: string) {
    return this.socialHistoryService.findOne(id, workspaceId);
  }

  /**
   * Update social history
   */
  async updateSocialHistory(id: string, dto: any, userId: string, workspaceId: string) {
    return this.socialHistoryService.update(id, dto, userId, workspaceId);
  }

  /**
   * Delete social history (soft delete)
   */
  async removeSocialHistory(id: string, userId: string, workspaceId: string) {
    return this.socialHistoryService.remove(id, userId, workspaceId);
  }

  /**
   * Find patients by smoking status
   */
  async findBySmokingStatus(
    status: any,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.socialHistoryService.findBySmokingStatus(status, workspaceId, page, limit);
  }

  /**
   * Find high-risk patients (smoking, alcohol, drug use)
   */
  async findHighRiskPatients(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.socialHistoryService.findRiskPatients(workspaceId, page, limit);
  }

  // ==================== MEDICAL HISTORY ====================

  /**
   * Create a new medical history record
   */
  async createMedicalHistory(dto: any, userId: string, workspaceId: string) {
    return this.medicalHistoryService.create(dto, userId, workspaceId);
  }

  /**
   * Get all medical history records with filters
   */
  async findAllMedicalHistory(query: any, workspaceId: string) {
    return this.medicalHistoryService.findAll(query, workspaceId);
  }

  /**
   * Get medical history for a specific patient
   */
  async findPatientMedicalHistory(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.medicalHistoryService.findByPatient(patientId, workspaceId, page, limit);
  }

  /**
   * Get chronic conditions for a patient
   */
  async findPatientChronicConditions(patientId: string, workspaceId: string) {
    return this.medicalHistoryService.findChronic(patientId, workspaceId);
  }

  /**
   * Get a single medical history record
   */
  async findOneMedicalHistory(id: string, workspaceId: string) {
    return this.medicalHistoryService.findOne(id, workspaceId);
  }

  /**
   * Update a medical history record
   */
  async updateMedicalHistory(id: string, dto: any, userId: string, workspaceId: string) {
    return this.medicalHistoryService.update(id, dto, userId, workspaceId);
  }

  /**
   * Delete a medical history record (soft delete)
   */
  async removeMedicalHistory(id: string, userId: string, workspaceId: string) {
    return this.medicalHistoryService.remove(id, userId, workspaceId);
  }

  // ==================== SURGICAL HISTORY ====================

  /**
   * Create a new surgical history record
   */
  async createSurgicalHistory(dto: any, userId: string, workspaceId: string) {
    return this.surgicalHistoryService.create(dto, userId, workspaceId);
  }

  /**
   * Get all surgical history records with filters
   */
  async findAllSurgicalHistory(query: any, workspaceId: string) {
    return this.surgicalHistoryService.findAll(query, workspaceId);
  }

  /**
   * Get surgical history for a specific patient
   */
  async findPatientSurgicalHistory(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.surgicalHistoryService.findByPatient(patientId, workspaceId, page, limit);
  }

  /**
   * Get a single surgical history record
   */
  async findOneSurgicalHistory(id: string, workspaceId: string) {
    return this.surgicalHistoryService.findOne(id, workspaceId);
  }

  /**
   * Update a surgical history record
   */
  async updateSurgicalHistory(id: string, dto: any, userId: string, workspaceId: string) {
    return this.surgicalHistoryService.update(id, dto, userId, workspaceId);
  }

  /**
   * Delete a surgical history record (soft delete)
   */
  async removeSurgicalHistory(id: string, userId: string, workspaceId: string) {
    return this.surgicalHistoryService.remove(id, userId, workspaceId);
  }

  /**
   * Find surgeries with complications
   */
  async findSurgeriesWithComplications(
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.surgicalHistoryService.findWithComplications(workspaceId, page, limit);
  }

  // ==================== FAMILY CONDITIONS ====================

  /**
   * Create a new family condition record
   */
  async createFamilyCondition(dto: any, userId: string, workspaceId: string) {
    return this.familyConditionsService.create(dto, userId, workspaceId);
  }

  /**
   * Get all family conditions with filters
   */
  async findAllFamilyConditions(query: any, workspaceId: string) {
    return this.familyConditionsService.findAll(query, workspaceId);
  }

  /**
   * Get family conditions for a specific patient
   */
  async findPatientFamilyConditions(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.familyConditionsService.findByPatient(patientId, workspaceId, page, limit);
  }

  /**
   * Get a single family condition record
   */
  async findOneFamilyCondition(id: string, workspaceId: string) {
    return this.familyConditionsService.findOne(id, workspaceId);
  }

  /**
   * Update a family condition record
   */
  async updateFamilyCondition(id: string, dto: any, userId: string, workspaceId: string) {
    return this.familyConditionsService.update(id, dto, userId, workspaceId);
  }

  /**
   * Delete a family condition record (soft delete)
   */
  async removeFamilyCondition(id: string, userId: string, workspaceId: string) {
    return this.familyConditionsService.remove(id, userId, workspaceId);
  }

  /**
   * Get pattern analysis for patient's family history
   * Includes genetic risk assessment and hereditary patterns
   */
  async getPatternAnalysis(patientId: string, workspaceId: string): Promise<any> {
    return this.familyConditionsService.getPatternAnalysis(patientId, workspaceId);
  }

  // ==================== COMPOSITE OPERATIONS ====================

  /**
   * Get complete patient history (all types)
   *
   * Returns comprehensive patient medical history including:
   * - Active allergies
   * - Current social history
   * - Active medical conditions
   * - Surgical procedures
   *
   * @param patientId - Patient UUID
   * @param workspaceId - Workspace UUID
   * @returns Complete patient history object
   */
  async getCompletePatientHistory(patientId: string, workspaceId: string) {
    this.logger.log('Fetching complete patient history', { patientId, workspaceId });

    try {
      const [allergies, socialHistory, medicalHistory, surgicalHistory, familyConditions] = await Promise.all([
        this.allergiesService.findByPatient(patientId, workspaceId, 1, 100),
        this.socialHistoryService.findByPatient(patientId, workspaceId),
        this.medicalHistoryService.findByPatient(patientId, workspaceId, 1, 100),
        this.surgicalHistoryService.findByPatient(patientId, workspaceId, 1, 100),
        this.familyConditionsService.findByPatient(patientId, workspaceId, 1, 100),
      ]);

      const history = {
        patientId,
        allergies: allergies.data || [],
        allergyCount: allergies.meta?.total || 0,
        socialHistory: socialHistory || null,
        medicalHistory: medicalHistory.data || [],
        medicalHistoryCount: medicalHistory.meta?.total || 0,
        surgicalHistory: surgicalHistory.data || [],
        surgicalHistoryCount: surgicalHistory.meta?.total || 0,
        familyConditions: familyConditions.data || [],
        familyConditionCount: familyConditions.meta?.total || 0,
        lastUpdated: new Date().toISOString(),
      };

      this.logger.log('Complete patient history fetched successfully', {
        patientId,
        allergyCount: history.allergyCount,
        medicalCount: history.medicalHistoryCount,
        surgicalCount: history.surgicalHistoryCount,
        familyConditionCount: history.familyConditionCount,
      });

      try {
        await this.auditLogService.log({
          userId: 'system',
          action: 'READ_COMPLETE_PATIENT_HISTORY',
          eventType: AuditEventType.READ,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Patient',
          resourceId: patientId,
          patientId,
          justification: 'Complete patient history accessed (composite PHI aggregation)',
          metadata: {
            allergyCount: history.allergyCount,
            medicalCount: history.medicalHistoryCount,
            surgicalCount: history.surgicalHistoryCount,
            familyConditionCount: history.familyConditionCount,
          },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log for getCompletePatientHistory', auditError.stack);
      }

      return history;
    } catch (error) {
      this.logger.error('Failed to fetch complete patient history', error.stack, {
        patientId,
        workspaceId,
      });
      throw error;
    }
  }

  /**
   * Get patient risk profile
   *
   * Assesses patient risk based on:
   * - Severe allergies
   * - High-risk social behaviors (smoking, alcohol, drugs)
   * - Chronic medical conditions
   * - Recent surgeries
   *
   * @param patientId - Patient UUID
   * @param workspaceId - Workspace UUID
   * @returns Risk assessment object
   */
  async getPatientRiskProfile(patientId: string, workspaceId: string) {
    this.logger.log('Calculating patient risk profile', { patientId, workspaceId });

    try {
      const history = await this.getCompletePatientHistory(patientId, workspaceId);

      // Count severe allergies
      const severeAllergies = history.allergies.filter(
        (a: any) => a.severity === 'SEVERE' || a.severity === 'LIFE_THREATENING',
      ).length;

      // Check social risk factors
      const socialRisk = history.socialHistory
        ? this.assessSocialRisk(history.socialHistory)
        : 'UNKNOWN';

      // Count chronic conditions
      const chronicConditions = history.medicalHistory.filter(
        (m: any) => m.status === 'ACTIVE' && m.isChronic,
      ).length;

      // Check recent surgeries (last 90 days)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const recentSurgeries = history.surgicalHistory.filter((s: any) => {
        const surgeryDate = new Date(s.dateOfSurgery);
        return surgeryDate >= ninetyDaysAgo;
      }).length;

      const riskProfile = {
        patientId,
        overallRisk: this.calculateOverallRisk(
          severeAllergies,
          socialRisk,
          chronicConditions,
          recentSurgeries,
        ),
        factors: {
          severeAllergies,
          socialRisk,
          chronicConditions,
          recentSurgeries,
        },
        recommendations: this.generateRecommendations(
          severeAllergies,
          socialRisk,
          chronicConditions,
        ),
        assessedAt: new Date().toISOString(),
      };

      this.logger.log('Risk profile calculated', {
        patientId,
        overallRisk: riskProfile.overallRisk,
      });

      try {
        await this.auditLogService.log({
          userId: 'system',
          action: 'READ_PATIENT_RISK_PROFILE',
          eventType: AuditEventType.READ,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'Patient',
          resourceId: patientId,
          patientId,
          justification: 'Patient risk profile assessment (composite PHI analysis)',
          metadata: { overallRisk: riskProfile.overallRisk },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log for getPatientRiskProfile', auditError.stack);
      }

      return riskProfile;
    } catch (error) {
      this.logger.error('Failed to calculate risk profile', error.stack, {
        patientId,
        workspaceId,
      });
      throw error;
    }
  }

  /**
   * Assess social risk factors
   * @private
   */
  private assessSocialRisk(socialHistory: any): string {
    let riskScore = 0;

    // Smoking
    if (socialHistory.smokingStatus === 'CURRENT') riskScore += 3;
    else if (socialHistory.smokingStatus === 'FORMER') riskScore += 1;

    // Alcohol
    if (socialHistory.alcoholUse === 'REGULARLY') riskScore += 2;
    else if (socialHistory.alcoholUse === 'OCCASIONALLY') riskScore += 1;

    // Drugs
    if (socialHistory.drugUse === 'CURRENT') riskScore += 3;
    else if (socialHistory.drugUse === 'FORMER') riskScore += 1;

    if (riskScore >= 6) return 'HIGH';
    if (riskScore >= 3) return 'MODERATE';
    if (riskScore >= 1) return 'LOW';
    return 'MINIMAL';
  }

  /**
   * Calculate overall risk level
   * @private
   */
  private calculateOverallRisk(
    severeAllergies: number,
    socialRisk: string,
    chronicConditions: number,
    recentSurgeries: number,
  ): string {
    let riskScore = 0;

    // Allergies
    if (severeAllergies >= 3) riskScore += 3;
    else if (severeAllergies >= 1) riskScore += 2;

    // Social factors
    if (socialRisk === 'HIGH') riskScore += 3;
    else if (socialRisk === 'MODERATE') riskScore += 2;
    else if (socialRisk === 'LOW') riskScore += 1;

    // Chronic conditions
    if (chronicConditions >= 3) riskScore += 3;
    else if (chronicConditions >= 1) riskScore += 2;

    // Recent surgeries
    if (recentSurgeries >= 2) riskScore += 2;
    else if (recentSurgeries >= 1) riskScore += 1;

    if (riskScore >= 8) return 'CRITICAL';
    if (riskScore >= 5) return 'HIGH';
    if (riskScore >= 3) return 'MODERATE';
    if (riskScore >= 1) return 'LOW';
    return 'MINIMAL';
  }

  /**
   * Generate clinical recommendations based on risk factors
   * @private
   */
  private generateRecommendations(
    severeAllergies: number,
    socialRisk: string,
    chronicConditions: number,
  ): string[] {
    const recommendations: string[] = [];

    if (severeAllergies >= 1) {
      recommendations.push('Review allergy management plan with patient');
      recommendations.push('Ensure emergency medications are prescribed');
    }

    if (socialRisk === 'HIGH' || socialRisk === 'MODERATE') {
      recommendations.push('Consider referral to substance abuse counseling');
      recommendations.push('Schedule follow-up for lifestyle modification');
    }

    if (chronicConditions >= 2) {
      recommendations.push('Coordinate care with specialists for chronic conditions');
      recommendations.push('Review medication adherence and interactions');
    }

    if (recommendations.length === 0) {
      recommendations.push('Continue routine preventive care');
    }

    return recommendations;
  }
}
