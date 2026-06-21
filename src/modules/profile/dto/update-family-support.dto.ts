import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateFamilySupportDto {
  @ApiPropertyOptional({ example: 5000, description: 'Monthly family support in selected currency' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare familySupportMonthly?: number;
}
