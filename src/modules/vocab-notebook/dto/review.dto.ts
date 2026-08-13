import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ReviewResult } from '@prisma/client';

export class StartReviewDto {
  @ApiPropertyOptional({ example: 'clxyz123', description: 'Omit to review across all categories' })
  @IsOptional()
  @IsString()
  declare categoryId?: string;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 20, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  declare count?: number;
}

export class SubmitWordReviewDto {
  @ApiPropertyOptional({ example: 'clxyz123' })
  @IsString()
  declare vocabWordId: string;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-...',
    description: 'The sessionId returned by /review/start for this review session, used to deprioritize this word on the next session.',
  })
  @IsOptional()
  @IsString()
  declare sessionId?: string;

  @ApiPropertyOptional({
    enum: ReviewResult,
    description:
      'Self-rated difficulty from a flip-card review (Quick Review). Omit for the handwriting-trace flow, which has no difficulty rating and keeps the existing pass-through progression.',
  })
  @IsOptional()
  @IsEnum(ReviewResult)
  declare result?: ReviewResult;
}
