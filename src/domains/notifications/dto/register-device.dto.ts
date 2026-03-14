import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DevicePlatform {
  ANDROID = 'android',
  IOS = 'ios',
  WEB = 'web',
}

export class RegisterDeviceDto {
  @ApiProperty({
    description: 'FCM registration token from the device',
    example: 'dGhpcyBpcyBhIGZha2UgdG9rZW4...',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  deviceToken: string;

  @ApiProperty({
    description: 'Device platform',
    enum: DevicePlatform,
    example: DevicePlatform.ANDROID,
  })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @ApiPropertyOptional({
    description: 'Human-readable device name',
    example: 'Pixel 8 Pro',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceName?: string;
}
