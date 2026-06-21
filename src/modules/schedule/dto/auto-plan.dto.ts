import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AutoPlanDto {
  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  declare date: string;

  @ApiPropertyOptional({ example: 8, description: 'Start hour (0–23)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  declare startHour?: number;

  @ApiPropertyOptional({ example: 22, description: 'End hour (0–23)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  declare endHour?: number;
}

export class DateQueryDto {
  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  declare date: string;
}
