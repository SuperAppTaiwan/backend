import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateNotificationPreferenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare taskReminder?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare goalReminder?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare budgetWarning?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare dailyVocabulary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare weeklySummary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare pushEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare emailEnabled?: boolean;

  @ApiPropertyOptional({ example: '22:00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'quietHoursStart must be HH:MM' })
  declare quietHoursStart?: string;

  @ApiPropertyOptional({ example: '07:00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'quietHoursEnd must be HH:MM' })
  declare quietHoursEnd?: string;
}

export class CreateNotificationDto {
  @ApiProperty()
  @IsString()
  declare type: string;

  @ApiProperty()
  @IsString()
  declare title: string;

  @ApiProperty()
  @IsString()
  declare message: string;
}
