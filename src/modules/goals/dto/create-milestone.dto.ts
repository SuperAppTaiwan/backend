import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateMilestoneDto {
  @ApiProperty({ example: 'Save first 20,000 TWD' })
  @IsString()
  @MaxLength(200)
  declare title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare targetAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare targetDate?: string;
}

export class UpdateMilestoneDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare targetAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare targetDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare isCompleted?: boolean;
}
