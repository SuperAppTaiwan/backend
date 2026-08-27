import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class MarkRecurringExpensePaidDto {
  @ApiProperty({
    example: '2027-08-20',
    description:
      'Which occurrence is being paid, as its exact due date (must match a real occurrence of ' +
      'this recurring expense\'s rule). Required so the client always disambiguates the target ' +
      'occurrence — e.g. paying August early while September is also visible in a forecast.',
  })
  @IsDateString()
  declare scheduledDueDate: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Whether the obligation should keep recurring after this payment. false hard-deletes the recurring definition (payment history is preserved).',
  })
  @IsOptional()
  @IsBoolean()
  declare continueRecurring?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'Auto-create a linked Expense transaction for this payment. Set false if the user already recorded it manually to avoid a duplicate.',
  })
  @IsOptional()
  @IsBoolean()
  declare createExpenseTransaction?: boolean;
}
