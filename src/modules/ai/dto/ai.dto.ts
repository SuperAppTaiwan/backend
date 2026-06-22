import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AISuggestionStatus } from '@prisma/client';

export class ChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsEnum(['user', 'assistant'])
  declare role: 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  declare content: string;
}

export class ChatRequestDto {
  @ApiProperty({ type: [ChatMessageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  declare messages: ChatMessageDto[];
}

export class GenerateRecommendationsDto {
  @ApiPropertyOptional({ description: 'Force regenerate even if recently generated' })
  @IsOptional()
  declare force?: boolean;
}

export class UpdateSuggestionStatusDto {
  @ApiProperty({ enum: AISuggestionStatus })
  @IsEnum(AISuggestionStatus)
  declare status: AISuggestionStatus;
}

export class CreateConversationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare title?: string;
}

export class SendMessageDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  declare content: string;
}
