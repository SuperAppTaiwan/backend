import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Shared across registration and profile health-update DTOs — kept in the
// profile module and imported elsewhere (plain classes, no DI, so importing
// across module boundaries doesn't create a circular Nest module graph).

export enum AllergyType {
  INGREDIENT = 'ingredient',
  FOOD = 'food',
  SUBSTANCE = 'substance',
  OTHER = 'other',
}

export enum AllergySeverity {
  MILD = 'mild',
  MODERATE = 'moderate',
  SEVERE = 'severe',
}

export enum HealthConditionStatus {
  ACTIVE = 'active',
  CONTROLLED = 'controlled',
  HISTORICAL = 'historical',
}

export class AllergyDto {
  @ApiPropertyOptional({ example: 'Đậu phộng (Peanuts)' })
  @IsString()
  @MaxLength(100)
  declare name: string;

  @ApiPropertyOptional({ enum: AllergyType })
  @IsOptional()
  @IsEnum(AllergyType)
  declare type?: AllergyType;

  @ApiPropertyOptional({ enum: AllergySeverity })
  @IsOptional()
  @IsEnum(AllergySeverity)
  declare severity?: AllergySeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  declare note?: string;
}

export class HealthConditionDto {
  @ApiPropertyOptional({ example: 'Tiểu đường (Diabetes)' })
  @IsString()
  @MaxLength(100)
  declare name: string;

  @ApiPropertyOptional({ enum: HealthConditionStatus })
  @IsOptional()
  @IsEnum(HealthConditionStatus)
  declare status?: HealthConditionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  declare note?: string;
}

export class MedicationDto {
  @ApiPropertyOptional({ example: 'Metformin' })
  @IsString()
  @MaxLength(150)
  declare name: string;

  @ApiPropertyOptional({ example: '500mg' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare dosage?: string;

  @ApiPropertyOptional({ example: 'once daily' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare frequency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  declare note?: string;
}

// Reusable field-level decorators for weightKg/heightCm/allergies/healthConditions/medications,
// shared by RegisterDto (all optional) and UpdateHealthProfileDto (all optional + nullable-to-clear).
// IsOptional() in class-validator skips validation for both undefined AND null, so these fields
// support: omit (no change / not provided), null (explicit clear), or a valid value.

export class HealthProfileFieldsDto {
  @ApiPropertyOptional({ example: 65, description: 'Weight in kilograms' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  declare weightKg?: number | null;

  @ApiPropertyOptional({ example: 172, description: 'Height in centimeters' })
  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(300)
  declare heightCm?: number | null;

  @ApiPropertyOptional({ type: [AllergyDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllergyDto)
  declare allergies?: AllergyDto[] | null;

  @ApiPropertyOptional({ type: [HealthConditionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HealthConditionDto)
  declare healthConditions?: HealthConditionDto[] | null;

  @ApiPropertyOptional({ type: [MedicationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MedicationDto)
  declare medications?: MedicationDto[] | null;
}

export class UpdateHealthProfileDto extends HealthProfileFieldsDto {}
