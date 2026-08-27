import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export { RecurringExpenseFrequency, RecurringExpenseReminderOffset };

export class CreateRecurringExpenseDto {
  @ApiProperty({ example: 'Tiền nhà' })
  @IsString()
  @MaxLength(200)
  declare name: string;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  @Min(0.01)
  declare amount: number;

  @ApiPropertyOptional({ example: 'TWD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  declare currency?: string;

  @ApiPropertyOptional({ description: 'Expense category ID' })
  @IsOptional()
  @IsString()
  declare categoryId?: string;

  @ApiProperty({ enum: RecurringExpenseFrequency })
  @IsEnum(RecurringExpenseFrequency)
  declare frequency: RecurringExpenseFrequency;

  @ApiProperty({
    example: '2027-08-20',
    description: 'The first/next due date. Its weekday (WEEKLY), day-of-month (MONTHLY), or month+day (YEARLY) anchors the recurrence pattern.',
  })
  @IsDateString()
  declare firstDueDate: string;

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
