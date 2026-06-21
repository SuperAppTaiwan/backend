import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { FixedEventType } from '@prisma/client';

export class CreateFixedEventDto {
  @ApiProperty({ example: 'Tiếng Trung HSK 3' })
  @IsString()
  @MaxLength(200)
  declare title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  declare description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare location?: string;

  @ApiProperty({ example: '2026-07-01T09:00:00.000Z' })
  @IsDateString()
  declare startTime: string;

  @ApiProperty({ example: '2026-07-01T11:00:00.000Z' })
  @IsDateString()
  declare endTime: string;

  @ApiPropertyOptional({ example: 'Asia/Taipei' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declare timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare recurrenceRule?: string;

  @ApiPropertyOptional({ enum: FixedEventType })
  @IsOptional()
  @IsEnum(FixedEventType)
  declare eventType?: FixedEventType;
}

export class UpdateFixedEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  declare description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare startTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declare timezone?: string;

  @ApiPropertyOptional({ enum: FixedEventType })
  @IsOptional()
  @IsEnum(FixedEventType)
  declare eventType?: FixedEventType;
}
