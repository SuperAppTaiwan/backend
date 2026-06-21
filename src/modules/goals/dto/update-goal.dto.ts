import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { GoalPriority, GoalStatus, GoalType } from '@prisma/client';

export class UpdateGoalDto {
  @ApiPropertyOptional({ enum: GoalType })
  @IsOptional()
  @IsEnum(GoalType)
  declare goalType?: GoalType;

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
  @IsNumber()
  @Min(0)
  declare currentAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare targetDate?: string;

  @ApiPropertyOptional({ enum: GoalPriority })
  @IsOptional()
  @IsEnum(GoalPriority)
  declare priority?: GoalPriority;

  @ApiPropertyOptional({ enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  declare status?: GoalStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  declare metadataJson?: Record<string, unknown>;
}
