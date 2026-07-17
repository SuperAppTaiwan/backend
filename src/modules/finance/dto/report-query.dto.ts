import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class MonthYearQueryDto {
  @ApiProperty({ example: 6, description: '1-12' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  declare month: number;

  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  declare year: number;
}

export class TrendQueryDto {
  @ApiPropertyOptional({ example: 6, description: 'Number of trailing months to include (default 6)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(24)
  declare months?: number;
}
