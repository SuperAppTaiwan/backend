import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { GoalPriority, GoalType } from '@prisma/client';

export { GoalType, GoalPriority };

export class CreateGoalDto {
  @ApiProperty({ enum: GoalType })
  @IsEnum(GoalType)
  declare goalType: GoalType;

  @ApiProperty({ example: 'Mua xe máy' })
  @IsString()
  @MaxLength(200)
  declare title: string;

  @ApiPropertyOptional({ example: 80000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare targetAmount?: number;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  declare targetDate?: string;

  @ApiPropertyOptional({ enum: GoalPriority, default: 'MEDIUM' })
  @IsOptional()
  @IsEnum(GoalPriority)
  declare priority?: GoalPriority;

  @ApiPropertyOptional({ description: 'Arbitrary metadata' })
  @IsOptional()
  @IsObject()
  declare metadataJson?: Record<string, unknown>;
}
