import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ExpenseCategoryType } from '@prisma/client';

export { ExpenseCategoryType };

export class CreateExpenseCategoryDto {
  @ApiProperty({ example: 'Thuê nhà' })
  @IsString()
  @MaxLength(100)
  declare name: string;

  @ApiProperty({ enum: ExpenseCategoryType })
  @IsEnum(ExpenseCategoryType)
  declare type: ExpenseCategoryType;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  declare isDefault?: boolean;

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
