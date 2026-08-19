import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ExpenseCategoryType } from '@prisma/client';

export class UpdateExpenseCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare name?: string;

  @ApiPropertyOptional({ enum: ExpenseCategoryType })
  @IsOptional()
  @IsEnum(ExpenseCategoryType)
  declare type?: ExpenseCategoryType;

  @ApiPropertyOptional({ description: 'Ionicons glyph name, e.g. "fast-food-outline"' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declare icon?: string;

  @ApiPropertyOptional({ description: 'Hex color, e.g. "#F0647D"' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  declare color?: string;
}
