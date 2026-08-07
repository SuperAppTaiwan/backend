import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

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
}
