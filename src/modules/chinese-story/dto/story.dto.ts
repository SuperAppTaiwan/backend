import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class StoryParagraphDto {
  @ApiProperty({ example: '今天天气很好。' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  declare simplified: string;

  @ApiProperty({ example: '今天天氣很好。' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  declare traditional: string;

  @ApiProperty({ example: 'Hôm nay thời tiết rất đẹp.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  declare vietnamese: string;
}

export class StoryVocabularyUsedDto {
  @ApiProperty({ example: '工作' })
  @IsString()
  declare simplified: string;

  @ApiPropertyOptional({ example: '工作' })
  @IsOptional()
  @IsString()
  declare traditional?: string;

  @ApiPropertyOptional({ example: 'gōng zuò' })
  @IsOptional()
  @IsString()
  declare pinyin?: string;

  @ApiPropertyOptional({ example: 'công việc' })
  @IsOptional()
  @IsString()
  declare meaningVi?: string;
}

export class SaveStoryDto {
  @ApiProperty({ example: '美好的一天' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare titleSimplified: string;

  @ApiProperty({ example: '美好的一天' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare titleTraditional: string;

  @ApiProperty({ type: [StoryParagraphDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StoryParagraphDto)
  declare paragraphs: StoryParagraphDto[];

  @ApiPropertyOptional({ type: [StoryVocabularyUsedDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoryVocabularyUsedDto)
  declare vocabularyUsed?: StoryVocabularyUsedDto[];
}
