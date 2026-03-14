import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsUUID,
  IsDateString,
  Min,
} from 'class-validator';
import { PaymentStatus } from '../../../../common/enums';
import { PaginationDto } from '../common/pagination.dto';

export class CreatePaymentDto {
  @IsUUID()
  billId: string;

  @IsUUID()
  patientId: string;

  @IsUUID()
  paymentMethodId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @IsOptional()
  transactionId?: string;

  @IsString()
  @IsOptional()
  chequeNumber?: string;

  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  accountNumber?: string;

  @IsString()
  @IsOptional()
  cardLastFour?: string;

  @IsString()
  @IsOptional()
  cardType?: string;

  @IsString()
  @IsOptional()
  authorizationCode?: string;

  @IsString()
  @IsOptional()
  insuranceProvider?: string;

  @IsString()
  @IsOptional()
  insurancePolicyNumber?: string;

  @IsString()
  @IsOptional()
  authorizationNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptional()
  paymentDetails?: Record<string, any>;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdatePaymentDto {
  @IsEnum(PaymentStatus)
  @IsOptional()
  status?: PaymentStatus;

  @IsString()
  @IsOptional()
  transactionId?: string;

  @IsString()
  @IsOptional()
  authorizationCode?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  failureReason?: string;

  @IsOptional()
  paymentDetails?: Record<string, any>;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class PaymentQueryDto extends PaginationDto {
  @IsUUID()
  @IsOptional()
  billId?: string;

  @IsUUID()
  @IsOptional()
  patientId?: string;

  @IsEnum(PaymentStatus)
  @IsOptional()
  status?: PaymentStatus;

  @IsUUID()
  @IsOptional()
  paymentMethodId?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
