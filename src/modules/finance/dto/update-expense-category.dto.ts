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
}
