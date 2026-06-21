import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

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
