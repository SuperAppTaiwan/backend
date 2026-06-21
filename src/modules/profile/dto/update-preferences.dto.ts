import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ example: 'A2', description: 'HSK / TOCFL level' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  declare chineseLevel?: string;

  @ApiPropertyOptional({ example: 'vegetarian' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declare dietPreference?: string;

  @ApiPropertyOptional({ example: 'renting', description: 'renting | owning | with-family' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declare livingStatus?: string;

  @ApiPropertyOptional({ example: 30000, description: 'Monthly budget in selected currency' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare monthlyBudget?: number;

  @ApiPropertyOptional({ example: 'TWD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  declare currency?: string;

  @ApiPropertyOptional({ example: 'Asia/Taipei' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declare timezone?: string;
}
