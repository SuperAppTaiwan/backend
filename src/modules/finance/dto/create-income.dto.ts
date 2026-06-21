import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateIncomeDto {
  @ApiPropertyOptional({ description: 'Income source ID' })
  @IsOptional()
  @IsString()
  declare sourceId?: string;

  @ApiProperty({ example: 30000 })
  @IsNumber()
  @Min(0)
  declare amount: number;

  @ApiPropertyOptional({ example: 'TWD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  declare currency?: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  declare receivedDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare note?: string;
}
