import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ReviewResult } from '@prisma/client';

export class ReviewDto {
  @ApiProperty({ example: 'clx...' })
  @IsString()
  declare vocabularyId: string;

  @ApiProperty({ enum: ReviewResult })
  @IsEnum(ReviewResult)
  declare result: ReviewResult;

  @ApiPropertyOptional({ example: 85 })
  @IsOptional()
  @IsInt()
  @Min(0)
  declare score?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare note?: string;
}
