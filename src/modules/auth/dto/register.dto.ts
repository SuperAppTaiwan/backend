import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { HealthProfileFieldsDto } from '../../profile/dto/health-profile.dto.js';

// Health fields are optional at registration (see HealthProfileFieldsDto) — existing
// clients that only send email/password/displayName are unaffected.
export class RegisterDto extends HealthProfileFieldsDto {
  @ApiProperty({ example: 'Nguyễn Văn An' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  declare displayName: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  declare email: string;

  @ApiProperty({ example: 'strongPassword123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  declare password: string;
}
