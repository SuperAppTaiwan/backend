import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateVocabWordDto {
  @ApiProperty({ example: '工作' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declare simplified: string;

  @ApiProperty({ example: 'gōng zuò' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare simplifiedPinyin: string;

  @ApiPropertyOptional({ example: '工作' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare traditional?: string;

  @ApiPropertyOptional({ example: 'gōng zuò' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare traditionalPinyin?: string;

  @ApiProperty({ example: 'Làm việc, công việc' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  declare meaningVi: string;

  @ApiPropertyOptional({ example: '我每天工作八个小时。' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare example?: string;

  @ApiPropertyOptional({ example: 'clxyz123' })
  @IsOptional()
  @IsString()
  declare categoryId?: string;
}

export class UpdateVocabWordDto extends PartialType(
  OmitType(CreateVocabWordDto, ['categoryId'] as const),
) {
  @ApiPropertyOptional({ example: null, description: 'Pass null to unassign the category' })
  @IsOptional()
  @IsString()
  declare categoryId?: string | null;
}
