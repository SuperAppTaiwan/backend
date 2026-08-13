import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

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

// Deliberately lenient (every field optional/string, no MinLength/MaxLength) —
// unlike CreateVocabWordDto, a bad bulk row must never fail the whole HTTP
// request via ValidationPipe. Real per-field validation happens row-by-row in
// the service so each row can be reported as created/skipped/failed
// individually instead of the entire paste being rejected for one bad row.
export class BulkVocabWordItemDto {
  @ApiPropertyOptional({ example: '工作' })
  @IsOptional()
  @IsString()
  declare simplified?: string;

  @ApiPropertyOptional({ example: 'gōng zuò' })
  @IsOptional()
  @IsString()
  declare simplifiedPinyin?: string;

  @ApiPropertyOptional({ example: '工作' })
  @IsOptional()
  @IsString()
  declare traditional?: string;

  @ApiPropertyOptional({ example: 'gōng zuò' })
  @IsOptional()
  @IsString()
  declare traditionalPinyin?: string;

  @ApiPropertyOptional({ example: 'Làm việc, công việc' })
  @IsOptional()
  @IsString()
  declare meaningVi?: string;

  @ApiPropertyOptional({ example: '我每天工作八个小时。' })
  @IsOptional()
  @IsString()
  declare example?: string;

  @ApiPropertyOptional({ example: 'clxyz123' })
  @IsOptional()
  @IsString()
  declare categoryId?: string;
}

export class BulkCreateVocabWordsDto {
  @ApiProperty({ type: [BulkVocabWordItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkVocabWordItemDto)
  declare items: BulkVocabWordItemDto[];
}
