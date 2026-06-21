import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export { PaymentMethod };

export class CreateExpenseDto {
  @ApiPropertyOptional({ description: 'Expense category ID' })
  @IsOptional()
  @IsString()
  declare categoryId?: string;

  @ApiProperty({ example: 12000 })
  @IsNumber()
  @Min(0)
  declare amount: number;

  @ApiPropertyOptional({ example: 'TWD' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  declare currency?: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  declare expenseDate: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  declare paymentMethod: PaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare note?: string;
}
