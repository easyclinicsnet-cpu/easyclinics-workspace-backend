import { Patient } from '../entities/patient.entity';

export interface PatientWithAppointments extends Patient {
  hasUpcomingAppointments: boolean;
  lastConsultationDate?: Date;
}
