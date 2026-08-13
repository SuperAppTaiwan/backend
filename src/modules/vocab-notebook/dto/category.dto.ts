import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateVocabCategoryDto {
  @ApiProperty({ example: 'Công việc' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  // MinLength(1) alone accepts a whitespace-only string (e.g. "   ", length
  // 3) — the service then trims it to "" before persisting, creating a
  // blank-named category that renders as a broken empty pill in the
  // category filter. Require at least one non-whitespace character.
  @Matches(/\S/, { message: 'name must not be blank' })
  declare name: string;
}

export class UpdateVocabCategoryDto extends PartialType(CreateVocabCategoryDto) {}
