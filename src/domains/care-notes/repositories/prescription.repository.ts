import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { Prescription } from '../entities/prescription.entity';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { PrescriptionQueryDto } from '../dto/prescription';

/**
 * Repository for Prescription entity operations
 * Extends EncryptedRepository for automatic encryption/decryption of sensitive fields
 */
@Injectable()
export class PrescriptionRepository extends EncryptedRepository<Prescription> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(Prescription, dataSource, aesService, logger);
    this.logger.setContext('PrescriptionRepository');
  }

  /**
   * Define searchable encrypted fields for fuzzy search
   */
  protected getSearchableEncryptedFields(): string[] {
    return ['medicine', 'dose', 'route', 'frequency'];
  }

  /**
   * Define base filters for search queries
   */
  protected getSearchFilters(): Partial<FindOptionsWhere<Prescription>> {
    return { isActive: true };
  }

  /**
   * Find prescriptions by patient ID with pagination
   * Uses workspaceId from Appointment relationship
   */
  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Prescription[], number]> {
    try {
      this.logger.log(
        `Finding prescriptions for patient: ${patientId}, workspace: ${workspaceId}`,
      );

      const qb = this.createQueryBuilder('prescription')
        .innerJoin('prescription.consultation', 'consultation')
        .innerJoin('consultation.appointment', 'appointment')
        .where('appointment.workspaceId = :workspaceId', { workspaceId })
        .andWhere('consultation.patientId = :patientId', { patientId })
        .andWhere('prescription.deletedAt IS NULL')
        .orderBy('prescription.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [prescriptions, total] = await qb.getManyAndCount();

      // Decrypt prescriptions
      await Promise.all(
        prescriptions.map((p) => this.decryptEntityFields(p)),
      );

      this.logger.log(
        `Found ${prescriptions.length} prescriptions out of ${total} for patient: ${patientId}`,
      );

      return [prescriptions, total];
    } catch (error) {
      this.logger.error(
        `Error finding prescriptions by patient: ${patientId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find prescriptions by appointment ID
   * Uses workspaceId from Appointment relationship
   */
  async findByAppointment(
    appointmentId: string,
    workspaceId: string,
  ): Promise<Prescription[]> {
    try {
      this.logger.log(
        `Finding prescriptions for appointment: ${appointmentId}, workspace: ${workspaceId}`,
      );

      const qb = this.createQueryBuilder('prescription')
        .innerJoin('prescription.consultation', 'consultation')
        .innerJoin('consultation.appointment', 'appointment')
        .where('appointment.workspaceId = :workspaceId', { workspaceId })
        .andWhere('prescription.appointmentId = :appointmentId', {
          appointmentId,
        })
        .andWhere('prescription.deletedAt IS NULL')
        .orderBy('prescription.createdAt', 'DESC');

      const prescriptions = await qb.getMany();

      // Decrypt prescriptions
      await Promise.all(
        prescriptions.map((p) => this.decryptEntityFields(p)),
      );

      this.logger.log(
        `Found ${prescriptions.length} prescriptions for appointment: ${appointmentId}`,
      );

      return prescriptions;
    } catch (error) {
      this.logger.error(
        `Error finding prescriptions by appointment: ${appointmentId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find prescriptions by consultation ID
   * Uses workspaceId from Consultation's Appointment relationship
   */
  async findByConsultation(
    consultationId: string,
    workspaceId: string,
  ): Promise<Prescription[]> {
    try {
      this.logger.log(
        `Finding prescriptions for consultation: ${consultationId}, workspace: ${workspaceId}`,
      );

      const qb = this.createQueryBuilder('prescription')
        .innerJoin('prescription.consultation', 'consultation')
        .innerJoin('consultation.appointment', 'appointment')
        .where('appointment.workspaceId = :workspaceId', { workspaceId })
        .andWhere('prescription.consultationId = :consultationId', {
          consultationId,
        })
        .andWhere('prescription.deletedAt IS NULL')
        .orderBy('prescription.createdAt', 'DESC');

      const prescriptions = await qb.getMany();

      // Decrypt prescriptions
      await Promise.all(
        prescriptions.map((p) => this.decryptEntityFields(p)),
      );

      this.logger.log(
        `Found ${prescriptions.length} prescriptions for consultation: ${consultationId}`,
      );

      return prescriptions;
    } catch (error) {
      this.logger.error(
        `Error finding prescriptions by consultation: ${consultationId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find prescriptions by doctor ID with pagination
   * Uses workspaceId from Appointment relationship
   */
  async findByDoctor(
    doctorId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Prescription[], number]> {
    try {
      this.logger.log(
        `Finding prescriptions for doctor: ${doctorId}, workspace: ${workspaceId}`,
      );

      const qb = this.createQueryBuilder('prescription')
        .innerJoin('prescription.consultation', 'consultation')
        .innerJoin('consultation.appointment', 'appointment')
        .where('appointment.workspaceId = :workspaceId', { workspaceId })
        .andWhere('prescription.doctorId = :doctorId', { doctorId })
        .andWhere('prescription.deletedAt IS NULL')
        .orderBy('prescription.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [prescriptions, total] = await qb.getManyAndCount();

      // Decrypt prescriptions
      await Promise.all(
        prescriptions.map((p) => this.decryptEntityFields(p)),
      );

      this.logger.log(
        `Found ${prescriptions.length} prescriptions out of ${total} for doctor: ${doctorId}`,
      );

      return [prescriptions, total];
    } catch (error) {
      this.logger.error(
        `Error finding prescriptions by doctor: ${doctorId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find prescriptions with filters
   * Supports filtering by patient, doctor, appointment, consultation
   */
  async findWithFilters(
    query: PrescriptionQueryDto,
    workspaceId: string,
  ): Promise<[Prescription[], number]> {
    try {
      this.logger.log(
        `Finding prescriptions with filters, workspace: ${workspaceId}`,
      );

      const page = query.page || 1;
      const limit = Math.min(query.limit || 10, 100);

      const qb = this.createQueryBuilder('prescription')
        .innerJoin('prescription.consultation', 'consultation')
        .innerJoin('consultation.appointment', 'appointment')
        .where('appointment.workspaceId = :workspaceId', { workspaceId })
        .andWhere('prescription.deletedAt IS NULL');

      // Apply filters
      if (query.patientId) {
        qb.andWhere('consultation.patientId = :patientId', {
          patientId: query.patientId,
        });
      }

      if (query.doctorId) {
        qb.andWhere('prescription.doctorId = :doctorId', {
          doctorId: query.doctorId,
        });
      }

      if (query.appointmentId) {
        qb.andWhere('prescription.appointmentId = :appointmentId', {
          appointmentId: query.appointmentId,
        });
      }

      if (query.consultationId) {
        qb.andWhere('prescription.consultationId = :consultationId', {
          consultationId: query.consultationId,
        });
      }

      // Apply sorting
      const sortBy = query.sortBy || 'createdAt';
      const sortOrder = query.sortOrder || 'DESC';
      qb.orderBy(`prescription.${sortBy}`, sortOrder);

      // Apply pagination
      qb.skip((page - 1) * limit).take(limit);

      const [prescriptions, total] = await qb.getManyAndCount();

      // Decrypt prescriptions
      await Promise.all(
        prescriptions.map((p) => this.decryptEntityFields(p)),
      );

      this.logger.log(`Found ${prescriptions.length} prescriptions with filters`);

      return [prescriptions, total];
    } catch (error) {
      this.logger.error(
        'Error finding prescriptions with filters',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find single prescription by ID with workspace validation
   */
  async findOneByIdAndWorkspace(
    id: string,
    workspaceId: string,
  ): Promise<Prescription | null> {
    try {
      this.logger.log(
        `Finding prescription by ID: ${id}, workspace: ${workspaceId}`,
      );

      const qb = this.createQueryBuilder('prescription')
        .innerJoin('prescription.consultation', 'consultation')
        .innerJoin('consultation.appointment', 'appointment')
        .where('appointment.workspaceId = :workspaceId', { workspaceId })
        .andWhere('prescription.id = :id', { id })
        .andWhere('prescription.deletedAt IS NULL');

      const prescription = await qb.getOne();

      if (prescription) {
        await this.decryptEntityFields(prescription);
      }

      return prescription;
    } catch (error) {
      this.logger.error(
        `Error finding prescription by ID: ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
