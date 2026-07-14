import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TaskPriority } from '@prisma/client';
import { WeekdayCode } from '../recurrence.service.js';

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export class RecurrenceInputDto {
  @ApiProperty({ enum: ['WEEKLY', 'MONTHLY'] })
  @IsIn(['WEEKLY', 'MONTHLY'])
  declare frequency: 'WEEKLY' | 'MONTHLY';

  @ApiPropertyOptional({ example: 1, description: 'Repeat every N weeks/months (default 1)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  declare interval?: number;

  @ApiPropertyOptional({ enum: WEEKDAY_CODES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(WEEKDAY_CODES, { each: true })
  declare byWeekday?: WeekdayCode[];

  @ApiPropertyOptional({ enum: ['DAY_OF_MONTH', 'ORDINAL_WEEKDAY'] })
  @IsOptional()
  @IsIn(['DAY_OF_MONTH', 'ORDINAL_WEEKDAY'])
  declare monthlyType?: 'DAY_OF_MONTH' | 'ORDINAL_WEEKDAY';

  @ApiPropertyOptional({ enum: ['NEVER', 'UNTIL', 'COUNT'] })
  @IsOptional()
  @IsIn(['NEVER', 'UNTIL', 'COUNT'])
  declare endType?: 'NEVER' | 'UNTIL' | 'COUNT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare until?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  declare count?: number;
}

export class AiConstraintsInputDto {
  @ApiPropertyOptional({ enum: ['MORNING', 'AFTERNOON', 'EVENING', 'ANY'] })
  @IsOptional()
  @IsIn(['MORNING', 'AFTERNOON', 'EVENING', 'ANY'])
  declare preferredTimeOfDay?: 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANY';

  @ApiPropertyOptional({ enum: WEEKDAY_CODES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(WEEKDAY_CODES, { each: true })
  declare allowedWeekdays?: WeekdayCode[];

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  declare earliestStartTime?: string;

  @ApiPropertyOptional({ example: '22:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  declare latestEndTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare canSplit?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(5)
  declare minSessionMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  declare bufferMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare preferredDateRangeStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare preferredDateRangeEnd?: string;
}

export class CreateScheduleEventDto {
  @ApiProperty({ example: 'Họp nhóm dự án' })
  @IsString()
  @MaxLength(300)
  declare title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  declare description?: string;

  @ApiProperty({ enum: ['FIXED', 'AI_AUTO'] })
  @IsIn(['FIXED', 'AI_AUTO'])
  declare schedulingMode: 'FIXED' | 'AI_AUTO';

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  declare priority?: TaskPriority;

  @ApiPropertyOptional({ example: 'Asia/Taipei' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declare timezone?: string;

  @ApiPropertyOptional({ example: '2026-07-20T09:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  declare startAt?: string;

  @ApiPropertyOptional({ example: '2026-07-20T10:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  declare endAt?: string;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  declare estimatedDurationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare deadline?: string;

  @ApiPropertyOptional({ type: AiConstraintsInputDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AiConstraintsInputDto)
  declare constraints?: AiConstraintsInputDto;

  @ApiPropertyOptional({ type: RecurrenceInputDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RecurrenceInputDto)
  declare recurrence?: RecurrenceInputDto;

  @ApiPropertyOptional({ description: 'Create even if it conflicts with an existing FIXED item' })
  @IsOptional()
  @IsBoolean()
  declare forceCreate?: boolean;

  @ApiPropertyOptional({ description: 'For AI_AUTO: create unscheduled if no slot is found' })
  @IsOptional()
  @IsBoolean()
  declare allowUnscheduled?: boolean;
}

export class UpdateScheduleEventDto extends PartialType(CreateScheduleEventDto) {}

export class ScheduleEventQueryDto {
  @ApiProperty({ example: '2026-07-01T00:00:00.000Z' })
  @IsDateString()
  declare from: string;

  @ApiProperty({ example: '2026-07-31T23:59:59.000Z' })
  @IsDateString()
  declare to: string;
}

export class ConflictCheckDto {
  @ApiProperty({ example: '2026-07-20T09:00:00.000Z' })
  @IsDateString()
  declare startAt: string;

  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' })
  @IsDateString()
  declare endAt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  declare excludeId?: string;
}
