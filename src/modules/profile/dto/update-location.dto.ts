import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateLocationDto {
  @ApiPropertyOptional({ example: 'Taipei' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare locationCity?: string;
}
