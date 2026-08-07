import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateVocabCategoryDto {
  @ApiProperty({ example: 'Công việc' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declare name: string;
}

export class UpdateVocabCategoryDto extends PartialType(CreateVocabCategoryDto) {}
