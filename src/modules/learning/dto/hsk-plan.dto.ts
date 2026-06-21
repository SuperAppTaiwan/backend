import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class HskPlanDto {
  @ApiProperty({ example: 3, description: 'Target HSK level (1-9)' })
  @IsInt()
  @Min(1)
  @Max(9)
  declare targetLevel: number;

  @ApiProperty({ example: '2026-12-31' })
  @IsDateString()
  declare targetDate: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  declare dailyWordTarget?: number;
}
