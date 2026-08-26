import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { FoodService } from './food.service.js';
import {
  CreateIngredientDto,
  UpdateIngredientDto,
  CreateRecipeDto,
  UpdateRecipeDto,
  CreateMealPlanDto,
  UpdateMealPlanDto,
  CreateShoppingListDto,
  UpdateShoppingListDto,
  GenerateShoppingListDto,
  ToggleShoppingItemDto,
  ScanIngredientDto,
  GenerateRecipesDto,
  SuggestMealDto,
  AcceptMealSuggestionDto,
  NearbyStoresDto,
  AddShoppingItemDto,
  GetRecipesQueryDto,
  ValidateRecipesDto,
  AddRecipesDto,
  AiSuggestMealDto,
  SaveAiSuggestionDto,
} from './dto/food.dto.js';

@ApiTags('Food')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('food')
export class FoodController {
  constructor(private readonly foodService: FoodService) {}

  // ─── Ingredients ──────────────────────────────────────────────────────────

  @Get('ingredients')
  @ApiOperation({ summary: 'List all ingredients' })
  @ApiResponse({ status: 200, description: 'Returns all ingredients for the user' })
  getIngredients(@CurrentUser() user: AuthUser) {
    return this.foodService.getIngredients(user.userId);
  }

  @Get('ingredients/expiring')
  @ApiOperation({ summary: 'List expiring ingredients' })
  @ApiQuery({ name: 'days', required: false, type: Number, example: 7 })
  @ApiResponse({ status: 200, description: 'Ingredients expiring within N days' })
  getExpiringIngredients(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.foodService.getExpiringIngredients(user.userId, days ? parseInt(days, 10) : 7);
  }

  @Get('ingredients/:id')
  @ApiOperation({ summary: 'Get ingredient by id' })
  @ApiResponse({ status: 200, description: 'Ingredient detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getIngredient(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.foodService.getIngredient(user.userId, id);
  }

  @Post('ingredients')
  @ApiOperation({ summary: 'Create ingredient' })
  @ApiResponse({ status: 201, description: 'Ingredient created' })
  createIngredient(@CurrentUser() user: AuthUser, @Body() dto: CreateIngredientDto) {
    return this.foodService.createIngredient(user.userId, dto);
  }

  @Put('ingredients/:id')
  @ApiOperation({ summary: 'Update ingredient' })
  @ApiResponse({ status: 200, description: 'Ingredient updated' })
  updateIngredient(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateIngredientDto) {
    return this.foodService.updateIngredient(user.userId, id, dto);
  }

  @Delete('ingredients/:id')
  @ApiOperation({ summary: 'Delete ingredient' })
  @ApiResponse({ status: 200, description: 'Ingredient deleted' })
  deleteIngredient(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.foodService.deleteIngredient(user.userId, id);
  }

  // ─── Recipes ──────────────────────────────────────────────────────────────

  @Get('recipes')
  @ApiOperation({ summary: 'List user recipes — supports search/mealType filter and page/limit pagination' })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'mealType', required: false, enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'User recipes — plain array unless page/limit given, otherwise a paginated envelope' })
  getRecipes(@CurrentUser() user: AuthUser, @Query() query: GetRecipesQueryDto) {
    return this.foodService.getRecipesFiltered(user.userId, query);
  }

  @Get('recipes/recommendations')
  @ApiOperation({ summary: 'Get recipe recommendations based on current ingredients' })
  @ApiResponse({ status: 200, description: 'Ranked recipes matching current ingredient inventory' })
  getRecipeRecommendations(@CurrentUser() user: AuthUser) {
    return this.foodService.getRecipeRecommendations(user.userId);
  }

  @Get('recipes/:id')
  @ApiOperation({ summary: 'Get recipe by id' })
  @ApiResponse({ status: 200, description: 'Recipe detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getRecipe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.foodService.getRecipe(user.userId, id);
  }

  @Post('recipes')
  @ApiOperation({ summary: 'Create recipe' })
  @ApiResponse({ status: 201, description: 'Recipe created' })
  createRecipe(@CurrentUser() user: AuthUser, @Body() dto: CreateRecipeDto) {
    return this.foodService.createRecipe(user.userId, dto);
  }

  @Put('recipes/:id')
  @ApiOperation({ summary: 'Update recipe' })
  @ApiResponse({ status: 200, description: 'Recipe updated' })
  updateRecipe(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRecipeDto) {
    return this.foodService.updateRecipe(user.userId, id, dto);
  }

  @Delete('recipes/:id')
  @ApiOperation({ summary: 'Delete recipe' })
  @ApiResponse({ status: 200, description: 'Recipe deleted' })
  deleteRecipe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.foodService.deleteRecipe(user.userId, id);
  }

  // ─── Meal Plans ───────────────────────────────────────────────────────────

  @Get('meal-plans')
  @ApiOperation({ summary: 'Get meal plans for a week' })
  @ApiQuery({ name: 'date', required: false, type: String, example: '2026-06-21', description: 'Start of week (YYYY-MM-DD), defaults to today' })
  @ApiResponse({ status: 200, description: 'Meal plans for the week starting at date' })
  getMealPlans(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    return this.foodService.getMealPlans(user.userId, date);
  }

  @Post('meal-plans')
  @ApiOperation({ summary: 'Create meal plan entry' })
  @ApiResponse({ status: 201, description: 'Meal plan created' })
  createMealPlan(@CurrentUser() user: AuthUser, @Body() dto: CreateMealPlanDto) {
    return this.foodService.createMealPlan(user.userId, dto);
  }

  @Put('meal-plans/:id')
  @ApiOperation({ summary: 'Update meal plan entry' })
  @ApiResponse({ status: 200, description: 'Meal plan updated' })
  updateMealPlan(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateMealPlanDto) {
    return this.foodService.updateMealPlan(user.userId, id, dto);
  }

  @Delete('meal-plans/:id')
  @ApiOperation({ summary: 'Delete meal plan entry' })
  @ApiResponse({ status: 200, description: 'Meal plan deleted' })
  deleteMealPlan(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.foodService.deleteMealPlan(user.userId, id);
  }

  // ─── Meal Plan v2: recipe picker + AI dedupe flow ────────────────────────────

  @Post('meal-plans/validate-recipes')
  @ApiOperation({ summary: 'Check whether selected recipes are nutritionally suitable for a meal slot; returns AI advice when they are not' })
  @ApiResponse({ status: 200, description: 'Suitability result with warnings and AI advice' })
  validateRecipes(@CurrentUser() user: AuthUser, @Body() dto: ValidateRecipesDto) {
    return this.foodService.validateRecipesForMealPlan(user.userId, dto);
  }

  @Post('meal-plans/add-recipes')
  @ApiOperation({ summary: 'Add one or more existing recipes to a meal slot without duplicating recipe records' })
  @ApiResponse({ status: 201, description: 'Created meal items; duplicates already in this slot are skipped' })
  addRecipes(@CurrentUser() user: AuthUser, @Body() dto: AddRecipesDto) {
    return this.foodService.addRecipesToMealPlan(user.userId, dto);
  }

  @Post('meal-plans/ai-suggest')
  @ApiOperation({ summary: 'AI: generate a meal suggestion for a slot, flagged with duplicateStatus against the user\'s own recipes' })
  @ApiResponse({ status: 200, description: 'AI suggestions with duplicate detection — no recipe is created yet' })
  aiSuggestMeals(@CurrentUser() user: AuthUser, @Body() dto: AiSuggestMealDto) {
    return this.foodService.aiSuggestMeals(user.userId, dto);
  }

  @Post('meal-plans/save-ai-suggestion')
  @ApiOperation({ summary: 'Save an AI meal suggestion — reuses an existing recipe if a duplicate is found, otherwise creates one' })
  @ApiResponse({ status: 201, description: 'Recipe (created or reused) and updated meal plan' })
  saveAiSuggestion(@CurrentUser() user: AuthUser, @Body() dto: SaveAiSuggestionDto) {
    return this.foodService.saveAiSuggestion(user.userId, dto);
  }

  // ─── Shopping Lists ───────────────────────────────────────────────────────

  @Get('shopping-lists')
  @ApiOperation({ summary: 'List all shopping lists' })
  @ApiResponse({ status: 200, description: 'All shopping lists with items' })
  getShoppingLists(@CurrentUser() user: AuthUser) {
    return this.foodService.getShoppingLists(user.userId);
  }

  @Get('shopping-lists/:id')
  @ApiOperation({ summary: 'Get shopping list with items' })
  @ApiResponse({ status: 200, description: 'Shopping list detail with items' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getShoppingList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.foodService.getShoppingList(user.userId, id);
  }

  @Post('shopping-lists')
  @ApiOperation({ summary: 'Create shopping list' })
  @ApiResponse({ status: 201, description: 'Shopping list created' })
  createShoppingList(@CurrentUser() user: AuthUser, @Body() dto: CreateShoppingListDto) {
    return this.foodService.createShoppingList(user.userId, dto);
  }

  @Put('shopping-lists/:id')
  @ApiOperation({ summary: 'Update shopping list' })
  @ApiResponse({ status: 200, description: 'Shopping list updated' })
  updateShoppingList(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateShoppingListDto) {
    return this.foodService.updateShoppingList(user.userId, id, dto);
  }

  @Delete('shopping-lists/:id')
  @ApiOperation({ summary: 'Delete shopping list' })
  @ApiResponse({ status: 200, description: 'Shopping list deleted' })
  deleteShoppingList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.foodService.deleteShoppingList(user.userId, id);
  }

  @Post('shopping-lists/:id/generate')
  @ApiOperation({ summary: 'Auto-generate shopping list items from meal plan for a week' })
  @ApiResponse({ status: 200, description: 'Shopping list updated with generated items' })
  generateShoppingList(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: GenerateShoppingListDto) {
    return this.foodService.generateShoppingList(user.userId, id, dto);
  }

  @Put('shopping-lists/:id/items/:itemId')
  @ApiOperation({ summary: 'Toggle shopping list item purchased state' })
  @ApiResponse({ status: 200, description: 'Item updated' })
  toggleShoppingItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ToggleShoppingItemDto,
  ) {
    return this.foodService.toggleShoppingItem(user.userId, id, itemId, dto.isPurchased);
  }

  @Put('shopping-lists/:id/complete')
  @ApiOperation({ summary: 'Mark shopping list as completed' })
  @ApiResponse({ status: 200, description: 'Shopping list completed' })
  completeShoppingList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.foodService.completeShoppingList(user.userId, id);
  }

  @Post('shopping-lists/:id/items')
  @ApiOperation({ summary: 'Add a single item to a shopping list' })
  @ApiResponse({ status: 201, description: 'Item added' })
  addShoppingItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddShoppingItemDto) {
    return this.foodService.addShoppingItem(user.userId, id, dto);
  }

  // ─── AI Endpoints ─────────────────────────────────────────────────────────

  @Post('ingredients/scan')
  @ApiOperation({ summary: 'AI: Scan ingredient from camera image (base64)' })
  @ApiResponse({ status: 200, description: 'AI analysis result with detected ingredient info' })
  scanIngredient(@CurrentUser() user: AuthUser, @Body() dto: ScanIngredientDto) {
    return this.foodService.scanIngredient(user.userId, dto);
  }

  @Get('ingredients/barcode/:code')
  @ApiOperation({ summary: 'Look up product info by barcode (EAN/UPC) via Open Food Facts' })
  @ApiResponse({ status: 200, description: 'Product lookup result (found: false if not in database)' })
  lookupBarcode(@Param('code') code: string) {
    return this.foodService.lookupBarcode(code);
  }

  @Post('recipes/generate')
  @ApiOperation({ summary: 'AI: Generate recipe suggestions from current ingredient inventory' })
  @ApiResponse({ status: 200, description: 'AI-generated recipe suggestions' })
  generateRecipes(@CurrentUser() user: AuthUser, @Body() dto: GenerateRecipesDto) {
    return this.foodService.generateRecipes(user.userId, dto);
  }

  @Post('meal-plans/suggest')
  @ApiOperation({ summary: 'AI: Suggest a meal for a given date and meal type slot' })
  @ApiResponse({ status: 200, description: 'AI-generated meal suggestion with nutrition balance, schedule awareness, and meal-type constraints' })
  suggestMeal(@CurrentUser() user: AuthUser, @Body() dto: SuggestMealDto) {
    return this.foodService.suggestMeal(user.userId, dto);
  }

  @Post('meal-plans/accept-suggestion')
  @ApiOperation({ summary: 'Accept an AI meal suggestion — creates Recipe + MealPlan atomically' })
  @ApiResponse({ status: 201, description: 'MealPlan created with linked Recipe containing full ingredients and steps' })
  acceptMealSuggestion(@CurrentUser() user: AuthUser, @Body() dto: AcceptMealSuggestionDto) {
    return this.foodService.acceptMealSuggestion(user.userId, dto);
  }

  @Get('shopping/nearby')
  @ApiOperation({ summary: 'Find nearby grocery stores for an ingredient search query' })
  @ApiQuery({ name: 'query', required: true, type: String })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'lng', required: true, type: Number })
  @ApiQuery({ name: 'radius', required: false, type: Number, description: 'Radius in meters (default 3000)' })
  @ApiQuery({ name: 'locale', required: false, type: String, description: 'Locale hint: vi / zh-TW / en' })
  @ApiResponse({ status: 200, description: 'Nearby grocery stores' })
  nearbyStores(
    @CurrentUser() _user: AuthUser,
    @Query('query') query: string,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius') radius?: string,
    @Query('locale') locale?: string,
  ) {
    const dto: NearbyStoresDto = {
      query,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      radius: radius ? parseInt(radius, 10) : undefined,
      locale,
    };
    return this.foodService.nearbyStores(dto);
  }
}
