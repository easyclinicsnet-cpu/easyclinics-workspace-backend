import { Patient } from '../entities/patient.entity';
import { PatientResponseDto } from '../dto';
import { PatientWithAppointments } from '../interfaces/patient-with-appointments.interface';

export class PatientTransformer {
  static toResponseDto(patient: Patient): PatientResponseDto {
    return PatientResponseDto.fromEntity(patient);
  }
}
