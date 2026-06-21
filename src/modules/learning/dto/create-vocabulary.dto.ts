import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateVocabularyDto {
  @ApiProperty({ example: '學習' })
  @IsString()
  @MaxLength(100)
  declare traditional: string;

  @ApiProperty({ example: '学习' })
  @IsString()
  @MaxLength(100)
  declare simplified: string;

  @ApiProperty({ example: 'xué xí' })
  @IsString()
  @MaxLength(200)
  declare pinyin: string;

  @ApiProperty({ example: 'Học, học tập' })
  @IsString()
  @MaxLength(500)
  declare meaningVi: string;

  @ApiPropertyOptional({ example: 'to learn, to study' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare meaningEn?: string;

  @ApiPropertyOptional({ example: '我在學習中文。' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare exampleTraditional?: string;

  @ApiPropertyOptional({ example: '我在学习中文。' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare exampleSimplified?: string;

  @ApiPropertyOptional({ example: 'Wǒ zài xuéxí zhōngwén.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare examplePinyin?: string;

  @ApiPropertyOptional({ example: 'Tôi đang học tiếng Trung.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare exampleMeaningVi?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  declare hskLevel?: number;

  @ApiPropertyOptional({ example: 'education' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare topic?: string;

  @ApiPropertyOptional({ example: 'user' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declare source?: string;
}
