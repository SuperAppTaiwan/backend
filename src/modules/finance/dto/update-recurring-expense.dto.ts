import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { RecurringExpenseFrequency, RecurringExpenseReminderOffset } from '@prisma/client';

export class UpdateRecurringExpenseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  declare amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  declare currency?: string;

  @ApiPropertyOptional({ description: 'Expense category ID, or null to unset' })
  @IsOptional()
  @IsString()
  declare categoryId?: string | null;

  @ApiPropertyOptional({ enum: RecurringExpenseFrequency })
  @IsOptional()
  @IsEnum(RecurringExpenseFrequency)
  declare frequency?: RecurringExpenseFrequency;

  @ApiPropertyOptional({
    description:
      'Changing this (or frequency) re-anchors the recurrence pattern from this point forward. ' +
      'Already-paid occurrences remain immutable historical records regardless (see RecurringExpensePayment).',
  })
  @IsOptional()
  @IsDateString()
  declare firstDueDate?: string;

  @ApiPropertyOptional({ enum: RecurringExpenseReminderOffset })
  @IsOptional()
  @IsEnum(RecurringExpenseReminderOffset)
  declare reminderOffset?: RecurringExpenseReminderOffset;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare isActive?: boolean;
}
