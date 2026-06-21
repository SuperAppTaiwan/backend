import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  IsArray,
} from 'class-validator';
import { FoodCategory, MealType, UnitOfMeasure } from '@prisma/client';

// ─── Ingredient DTOs ─────────────────────────────────────────────────────────

export class CreateIngredientDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  declare name: string;

  @ApiPropertyOptional({ enum: FoodCategory })
  @IsOptional()
  @IsEnum(FoodCategory)
  declare category?: FoodCategory;

  @ApiPropertyOptional({ enum: UnitOfMeasure })
  @IsOptional()
  @IsEnum(UnitOfMeasure)
  declare unit?: UnitOfMeasure;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare purchasedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare cost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare notes?: string;
}

export class UpdateIngredientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  declare name?: string;

  @ApiPropertyOptional({ enum: FoodCategory })
  @IsOptional()
  @IsEnum(FoodCategory)
  declare category?: FoodCategory;

  @ApiPropertyOptional({ enum: UnitOfMeasure })
  @IsOptional()
  @IsEnum(UnitOfMeasure)
  declare unit?: UnitOfMeasure;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  declare expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare cost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare notes?: string;
}

export class PurchaseIngredientDto {
  @ApiPropertyOptional({ description: 'Actual purchase cost in TWD' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare cost?: number;

  @ApiPropertyOptional({ description: 'If true, create a Finance expense record' })
  @IsOptional()
  @IsBoolean()
  declare createExpense?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare note?: string;
}

// ─── Recipe DTOs ─────────────────────────────────────────────────────────────

export class RecipeIngredientItemDto {
  @ApiProperty()
  @IsString()
  declare name: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  declare quantity: number;

  @ApiProperty({ enum: UnitOfMeasure })
  @IsEnum(UnitOfMeasure)
  declare unit: UnitOfMeasure;
}

export class RecipeStepDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  declare step: number;

  @ApiProperty()
  @IsString()
  declare description: string;
}

export class CreateRecipeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  declare title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  declare servings?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  declare prepMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  declare cookMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare isPublic?: boolean;

  @ApiPropertyOptional({ enum: FoodCategory })
  @IsOptional()
  @IsEnum(FoodCategory)
  declare category?: FoodCategory;

  @ApiProperty({ type: [RecipeIngredientItemDto] })
  @IsArray()
  declare ingredientsJson: RecipeIngredientItemDto[];

  @ApiProperty({ type: [RecipeStepDto] })
  @IsArray()
  declare stepsJson: RecipeStepDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  declare tagsJson?: string[];
}

export class UpdateRecipeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  declare servings?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  declare prepMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  declare cookMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare isPublic?: boolean;

  @ApiPropertyOptional({ enum: FoodCategory })
  @IsOptional()
  @IsEnum(FoodCategory)
  declare category?: FoodCategory;

  @ApiPropertyOptional({ type: [RecipeIngredientItemDto] })
  @IsOptional()
  @IsArray()
  declare ingredientsJson?: RecipeIngredientItemDto[];

  @ApiPropertyOptional({ type: [RecipeStepDto] })
  @IsOptional()
  @IsArray()
  declare stepsJson?: RecipeStepDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  declare tagsJson?: string[];
}

// ─── Meal Plan DTOs ───────────────────────────────────────────────────────────

export class CreateMealPlanDto {
  @ApiProperty({ example: '2026-06-21' })
  @IsDateString()
  declare planDate: string;

  @ApiProperty({ enum: MealType })
  @IsEnum(MealType)
  declare mealType: MealType;

  @ApiPropertyOptional({ description: 'Recipe id (optional)' })
  @IsOptional()
  @IsString()
  declare recipeId?: string;

  @ApiPropertyOptional({ description: 'Free text meal if no recipe' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare customMeal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  declare servings?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare notes?: string;
}

export class UpdateMealPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  declare recipeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare customMeal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  declare servings?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare notes?: string;
}

// ─── Shopping List DTOs ───────────────────────────────────────────────────────

export class CreateShoppingListDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  declare name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare notes?: string;
}

export class UpdateShoppingListDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare notes?: string;
}

export class GenerateShoppingListDto {
  @ApiProperty({ example: '2026-06-21', description: 'Start date of week to generate from (YYYY-MM-DD)' })
  @IsDateString()
  declare weekStartDate: string;
}

export class ToggleShoppingItemDto {
  @ApiProperty()
  @IsBoolean()
  declare isPurchased: boolean;
}
