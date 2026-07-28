import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  ArrayMinSize,
  ValidateNested,
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

  @ApiPropertyOptional({ description: 'How the ingredient was added: manual / camera_scan / ai', example: 'manual' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declare sourceType?: string;

  @ApiPropertyOptional({ description: 'How expiry was determined: manual / ai / label', example: 'manual' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  declare expirySource?: string;

  @ApiPropertyOptional({ description: 'AI confidence score 0–1 when sourceType is camera_scan or ai' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare aiConfidence?: number;

  @ApiPropertyOptional({ description: 'AI-estimated freshness: fresh / good / aging / near_expiry / expired' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  declare freshnessStatus?: string;

  @ApiPropertyOptional({ description: 'AI-estimated days of shelf life remaining, when no OCR expiry date was found' })
  @IsOptional()
  @IsInt()
  declare estimatedDaysRemaining?: number;
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare isAiGenerated?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare aiReason?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  declare missingIngredients?: string[];

  @ApiPropertyOptional({ description: 'Nutrition info JSON { calories, protein, carbs, fat }' })
  @IsOptional()
  declare nutritionJson?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Recipe image URL' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare imageUrl?: string;

  @ApiPropertyOptional({ description: 'Recipe source (AI, manual, etc.)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare source?: string;
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare isAiGenerated?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare aiReason?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  declare missingIngredients?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  declare nutritionJson?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Recipe image URL' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare imageUrl?: string;

  @ApiPropertyOptional({ description: 'Recipe source' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  declare source?: string;
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  declare isAiGenerated?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare aiReason?: string;
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

// ─── AI DTOs ─────────────────────────────────────────────────────────────────

export class ScanIngredientDto {
  @ApiProperty({ description: 'Base64 encoded image (no data URI prefix needed, but supported)' })
  @IsString()
  declare imageBase64: string;

  @ApiPropertyOptional({ description: 'MIME type: image/jpeg or image/png' })
  @IsOptional()
  @IsString()
  declare mimeType?: string;
}

export class GenerateRecipesDto {
  @ApiPropertyOptional({ description: 'Max number of recipes to generate (default 3)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  declare count?: number;

  @ApiPropertyOptional({ description: 'Prioritize ingredients expiring within N days (default 7)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  declare expiryPriorityDays?: number;

  @ApiPropertyOptional({ type: [String], description: 'Additional ingredients/dishes to exclude beyond the user\'s saved allergies' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  declare excludedIngredients?: string[];
}

export class SuggestMealDto {
  @ApiProperty({ example: '2026-06-25', description: 'Date for the meal slot' })
  @IsDateString()
  declare planDate: string;

  @ApiProperty({ enum: MealType })
  @IsEnum(MealType)
  declare mealType: MealType;

  @ApiPropertyOptional({
    type: [String],
    description: 'Meal names already shown or saved in this slot — backend must not suggest any of these',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  declare excludeMeals?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Additional ingredients/dishes to exclude beyond the user\'s saved allergies' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  declare excludedIngredients?: string[];
}

export class AcceptMealSuggestionDto {
  @ApiProperty({ example: '2026-06-25', description: 'Date of the meal slot (YYYY-MM-DD)' })
  @IsDateString()
  declare planDate: string;

  @ApiProperty({ enum: MealType })
  @IsEnum(MealType)
  declare mealType: MealType;

  @ApiProperty({ description: 'Dish / meal name' })
  @IsString()
  @MaxLength(200)
  declare mealName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare description?: string;

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
  @IsInt()
  @Min(1)
  declare servings?: number;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare nutritionSummary?: string;

  @ApiPropertyOptional({ description: 'Structured nutrition { calories, protein, carbs, fat, fiber }' })
  @IsOptional()
  declare nutritionJson?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare aiReason?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  declare missingIngredients?: string[];
}

export class NearbyStoresDto {
  @ApiProperty({ description: 'Ingredient or item name to search for' })
  @IsString()
  declare query: string;

  @ApiProperty({ description: 'Latitude of user location' })
  @IsNumber()
  declare lat: number;

  @ApiProperty({ description: 'Longitude of user location' })
  @IsNumber()
  declare lng: number;

  @ApiPropertyOptional({ description: 'Search radius in meters (default 3000)' })
  @IsOptional()
  @IsNumber()
  @Min(100)
  declare radius?: number;

  @ApiPropertyOptional({ description: 'Locale hint: vi / zh-TW / en', example: 'vi' })
  @IsOptional()
  @IsString()
  declare locale?: string;
}

// ─── Meal Plan v2: recipe picker + AI dedupe flow ────────────────────────────

export class GetRecipesQueryDto {
  @ApiPropertyOptional({ description: 'Search by recipe title' })
  @IsOptional()
  @IsString()
  declare search?: string;

  @ApiPropertyOptional({ enum: MealType })
  @IsOptional()
  @IsEnum(MealType)
  declare mealType?: MealType;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare limit?: number;
}

export class ValidateRecipesDto {
  @ApiProperty({ example: '2026-07-07' })
  @IsDateString()
  declare date: string;

  @ApiProperty({ enum: MealType })
  @IsEnum(MealType)
  declare mealType: MealType;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  declare recipeIds: string[];
}

export class AddRecipesDto {
  @ApiProperty({ example: '2026-07-07' })
  @IsDateString()
  declare date: string;

  @ApiProperty({ enum: MealType })
  @IsEnum(MealType)
  declare mealType: MealType;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  declare recipeIds: string[];

  @ApiPropertyOptional({ description: 'Save even if validate-recipes reported nutrition warnings' })
  @IsOptional()
  @IsBoolean()
  declare ignoreWarnings?: boolean;
}

export class AiSuggestMealDto {
  @ApiProperty({ example: '2026-07-07' })
  @IsDateString()
  declare date: string;

  @ApiProperty({ enum: MealType })
  @IsEnum(MealType)
  declare mealType: MealType;

  @ApiPropertyOptional({ type: [String], description: 'Recipe ids already shown/rejected for this slot' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  declare excludeRecipeIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Recipe/meal names already shown/rejected for this slot' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  declare excludeRecipeNames?: string[];
}

export class AiSuggestionPayloadDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  declare name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  declare calories?: number;

  @ApiPropertyOptional()
  @IsOptional()
  declare nutrition?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [RecipeIngredientItemDto] })
  @IsOptional()
  @IsArray()
  declare ingredients?: RecipeIngredientItemDto[];

  @ApiPropertyOptional({ type: [RecipeStepDto] })
  @IsOptional()
  @IsArray()
  declare stepsJson?: RecipeStepDto[];

  @ApiPropertyOptional({ enum: FoodCategory })
  @IsOptional()
  @IsEnum(FoodCategory)
  declare category?: FoodCategory;

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
  @IsInt()
  @Min(1)
  declare servings?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare aiReason?: string;
}

export class SaveAiSuggestionDto {
  @ApiProperty({ example: '2026-07-07' })
  @IsDateString()
  declare date: string;

  @ApiProperty({ enum: MealType })
  @IsEnum(MealType)
  declare mealType: MealType;

  @ApiProperty({ type: AiSuggestionPayloadDto })
  @ValidateNested()
  @Type(() => AiSuggestionPayloadDto)
  declare suggestion: AiSuggestionPayloadDto;
}

export class AddShoppingItemDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  declare ingredientName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  declare quantity?: number;

  @ApiPropertyOptional({ enum: UnitOfMeasure })
  @IsOptional()
  @IsEnum(UnitOfMeasure)
  declare unit?: UnitOfMeasure;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare notes?: string;
}
