import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateBudgetDto {
  @ApiProperty({ example: 6, description: '1-12' })
  @IsInt()
  @Min(1)
  @Max(12)
  declare month: number;

  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2020)
  declare year: number;

  @ApiProperty({ example: 40000 })
  @IsNumber()
  @Min(0)
  declare totalLimit: number;

  @ApiPropertyOptional({ example: 'TWD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  declare currency?: string;

  @ApiPropertyOptional({ description: 'Per-category spending limits as { categoryId: amount }' })
  @IsOptional()
  @IsObject()
  declare categoryLimitsJson?: Record<string, number>;
}
