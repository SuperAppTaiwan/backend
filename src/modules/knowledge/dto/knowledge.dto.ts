import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { KnowledgeCategory, KnowledgeDifficulty } from '@prisma/client';

export class CreateArticleDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  declare title: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  declare summary: string;

  @ApiProperty()
  @IsString()
  declare content: string;

  @ApiPropertyOptional({ enum: KnowledgeCategory })
  @IsOptional()
  @IsEnum(KnowledgeCategory)
  declare category?: KnowledgeCategory;

  @ApiPropertyOptional({ enum: KnowledgeDifficulty })
  @IsOptional()
  @IsEnum(KnowledgeDifficulty)
  declare difficulty?: KnowledgeDifficulty;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  declare tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  declare estimatedReadMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare isPublished?: boolean;
}

export class UpdateArticleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  declare content?: string;

  @ApiPropertyOptional({ enum: KnowledgeCategory })
  @IsOptional()
  @IsEnum(KnowledgeCategory)
  declare category?: KnowledgeCategory;

  @ApiPropertyOptional({ enum: KnowledgeDifficulty })
  @IsOptional()
  @IsEnum(KnowledgeDifficulty)
  declare difficulty?: KnowledgeDifficulty;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  declare tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  declare estimatedReadMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare isPublished?: boolean;
}

export class CreateBookmarkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare notes?: string;
}
