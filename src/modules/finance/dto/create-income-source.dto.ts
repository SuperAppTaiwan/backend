import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { IncomeSourceType } from '@prisma/client';

export { IncomeSourceType };

export class CreateIncomeSourceDto {
  @ApiProperty({ example: 'Lương công ty' })
  @IsString()
  @MaxLength(100)
  declare name: string;

  @ApiProperty({ enum: IncomeSourceType })
  @IsEnum(IncomeSourceType)
  declare type: IncomeSourceType;

  @ApiProperty({ example: 30000, description: 'Expected monthly amount' })
  @IsNumber()
  @Min(0)
  declare expectedAmount: number;

  @ApiPropertyOptional({ example: 'TWD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  declare currency?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  declare isActive?: boolean;
}
