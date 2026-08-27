import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class RecurringExpenseForecastQueryDto {
  @ApiPropertyOptional({ default: 30, description: 'Forecast window in days for the "upcoming" list (next7Days/next30Days are always both included).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  declare days?: number;
}
