import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { WritingPageTemplate, WritingTraceMode } from '@prisma/client';
import { GRID_LIMITS, MAX_GUIDES_PER_PAGE, MAX_STROKES_PER_PAGE } from '../writing-notebook.constants.js';

export class CreateWritingNotebookDto {
  @ApiProperty({ example: 'Vở HSK 1' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/, { message: 'title must not be blank' })
  declare title: string;
}

export class UpdateWritingNotebookDto extends CreateWritingNotebookDto {}

export class GridConfigDto {
  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(GRID_LIMITS.columns.min)
  @Max(GRID_LIMITS.columns.max)
  declare columns: number;

  @ApiProperty({ example: 6 })
  @IsInt()
  @Min(GRID_LIMITS.rows.min)
  @Max(GRID_LIMITS.rows.max)
  declare rows: number;

  @ApiProperty({ example: 0.3, description: 'Page margin, as a fraction of the cell size' })
  @IsNumber()
  @Min(GRID_LIMITS.marginRatio.min)
  @Max(GRID_LIMITS.marginRatio.max)
  declare marginRatio: number;

  @ApiProperty({ example: 0.5, description: 'Pinyin band height, as a fraction of the cell size' })
  @IsNumber()
  @Min(GRID_LIMITS.pinyinBandRatio.min)
  @Max(GRID_LIMITS.pinyinBandRatio.max)
  declare pinyinBandRatio: number;

  @ApiProperty({ example: 0.2, description: 'Gap between rows, as a fraction of the cell size' })
  @IsNumber()
  @Min(GRID_LIMITS.rowGapRatio.min)
  @Max(GRID_LIMITS.rowGapRatio.max)
  declare rowGapRatio: number;
}

export class PageGuideDto {
  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  @Max(GRID_LIMITS.rows.max - 1)
  declare row: number;

  @ApiProperty({ example: '学' })
  @IsString()
  @MinLength(1)
  // One Hanzi can be a surrogate pair (length 2) — e.g. CJK Extension B.
  @MaxLength(2)
  declare character: string;

  @ApiPropertyOptional({ example: 'xué' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  pinyin?: string;
}

export class CreateWritingPageDto {
  @ApiProperty({ enum: WritingPageTemplate })
  @IsEnum(WritingPageTemplate)
  declare templateType: WritingPageTemplate;

  @ApiProperty({ type: GridConfigDto })
  @ValidateNested()
  @Type(() => GridConfigDto)
  declare gridConfig: GridConfigDto;

  @ApiPropertyOptional({ enum: WritingTraceMode, description: 'GUIDED only' })
  @IsOptional()
  @IsEnum(WritingTraceMode)
  traceMode?: WritingTraceMode;

  @ApiPropertyOptional({ type: [PageGuideDto], description: 'GUIDED only' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_GUIDES_PER_PAGE)
  @ValidateNested({ each: true })
  @Type(() => PageGuideDto)
  guides?: PageGuideDto[];
}

export class UpdateWritingPageDto {
  @ApiProperty({ example: 3, description: 'The version the client last saw; a stale value returns 409' })
  @IsInt()
  @Min(1)
  declare version: number;

  @ApiProperty({
    description:
      'Full stroke set for the page: [{ id, tool, color, width, startedAt?, points: [[x, y, t, pressure?], ...] }]. ' +
      'Validated and canonicalized by canonicalizeStrokes() — see stroke-validation.ts.',
    type: 'array',
    items: { type: 'object' },
  })
  @IsArray()
  @ArrayMaxSize(MAX_STROKES_PER_PAGE)
  declare strokes: unknown[];
}
