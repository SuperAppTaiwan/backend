import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { LearningPlanStatus } from '@prisma/client';

export class CreateLearningPlanDto {
  @ApiProperty({ example: 'Kế hoạch học HSK 3' })
  @IsString()
  @MaxLength(200)
  declare title: string;

  @ApiPropertyOptional({ example: 'HSK3' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  declare targetLevel?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  declare dailyWordTarget?: number;

  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  declare startDate: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  declare endDate?: string;
}

export class UpdateLearningPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  declare dailyWordTarget?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare endDate?: string;

  @ApiPropertyOptional({ enum: LearningPlanStatus })
  @IsOptional()
  @IsEnum(LearningPlanStatus)
  declare status?: LearningPlanStatus;
}
