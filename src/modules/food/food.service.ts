import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExpenseCategoryType, FoodCategory, PaymentMethod, Prisma, ShoppingListStatus, UnitOfMeasure } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { AIProviderChain } from '../ai/providers/ai-provider-chain.service.js';

const RECIPE_CATEGORY_IMAGES: Record<string, string> = {
  VEGETABLE: 'https://images.unsplash.com/photo-1512621776951-a57ef8c7f0cc?w=400&h=300&fit=crop&auto=format&q=80',
  FRUIT:     'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop&auto=format&q=80',
  MEAT:      'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=400&h=300&fit=crop&auto=format&q=80',
  SEAFOOD:   'https://images.unsplash.com/photo-1534482421-64566f976cfa?w=400&h=300&fit=crop&auto=format&q=80',
  DAIRY:     'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400&h=300&fit=crop&auto=format&q=80',
  GRAIN:     'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=400&h=300&fit=crop&auto=format&q=80',
  LEGUME:    'https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?w=400&h=300&fit=crop&auto=format&q=80',
  CONDIMENT: 'https://images.unsplash.com/photo-1506368083636-6defca67c417?w=400&h=300&fit=crop&auto=format&q=80',
  BEVERAGE:  'https://images.unsplash.com/photo-1544145945-f2cc9a85f2fd?w=400&h=300&fit=crop&auto=format&q=80',
  SNACK:     'https://images.unsplash.com/photo-1566478532765-5d37de7f2c58?w=400&h=300&fit=crop&auto=format&q=80',
  FROZEN:    'https://images.unsplash.com/photo-1548365328-8c6db3220f4e?w=400&h=300&fit=crop&auto=format&q=80',
  OTHER:     'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&h=300&fit=crop&auto=format&q=80',
};

interface OverpassElement {
  id: number | string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface StoreResult {
  id: number | string;
  name: string;
  nameZh: string | null;
  type: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  distanceLabel: string;
  address: string | null;
  openingHours: string | null;
  phone: string | null;
  mapsUrl: string;
  osmUrl: string;
}
import type {
  CreateIngredientDto,
  UpdateIngredientDto,
  PurchaseIngredientDto,
  CreateRecipeDto,
  UpdateRecipeDto,
  CreateMealPlanDto,
  UpdateMealPlanDto,
  CreateShoppingListDto,
  UpdateShoppingListDto,
  GenerateShoppingListDto,
  ScanIngredientDto,
  GenerateRecipesDto,
  SuggestMealDto,
  AcceptMealSuggestionDto,
  NearbyStoresDto,
  AddShoppingItemDto,
} from './dto/food.dto.js';

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly aiChain: AIProviderChain,
    private readonly config: ConfigService,
  ) {}

  private safeJson<T>(text: string, fallback: T): T {
    try {
      const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]) as T;
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  }

  // AI responses sometimes drift from the requested enum (wrong case, a synonym,
  // or an outright hallucinated value) — coerce to a valid Prisma enum member or fall back.
  private normalizeEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    if (typeof value === 'string') {
      const match = allowed.find((v) => v === value.trim().toUpperCase());
      if (match) return match;
    }
    return fallback;
  }

  // ─── Ingredients ──────────────────────────────────────────────────────────

  async getIngredients(userId: string) {
    return this.prisma.ingredient.findMany({
      where: { userId },
      orderBy: [{ expiresAt: 'asc' }, { name: 'asc' }],
    });
  }

  async getExpiringIngredients(userId: string, days = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    return this.prisma.ingredient.findMany({
      where: {
        userId,
        expiresAt: { not: null, lte: cutoff },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async getIngredient(userId: string, id: string) {
    const item = await this.prisma.ingredient.findFirst({ where: { id, userId } });
    if (!item) throw new NotFoundException('Ingredient not found');
    return item;
  }

  async createIngredient(userId: string, dto: CreateIngredientDto) {
    const ingredient = await this.prisma.ingredient.create({
      data: {
        userId,
        name: dto.name,
        category: dto.category,
        unit: dto.unit,
        quantity: dto.quantity ?? 0,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        purchasedAt: dto.purchasedAt ? new Date(dto.purchasedAt) : null,
        cost: dto.cost,
        location: dto.location,
        notes: dto.notes,
        sourceType: dto.sourceType ?? 'manual',
        expirySource: dto.expirySource ?? 'manual',
        aiConfidence: dto.aiConfidence,
        freshnessStatus: dto.freshnessStatus,
        estimatedDaysRemaining: dto.estimatedDaysRemaining,
      },
    });
    await this.events.publish({ userId, eventType: EventType.INGREDIENT_CREATED, sourceModule: 'food', payload: { id: ingredient.id, name: ingredient.name } });
    return ingredient;
  }

  async updateIngredient(userId: string, id: string, dto: UpdateIngredientDto) {
    await this.getIngredient(userId, id);
    const updated = await this.prisma.ingredient.update({
      where: { id },
      data: {
        name: dto.name,
        category: dto.category,
        unit: dto.unit,
        quantity: dto.quantity,
        expiresAt: dto.expiresAt !== undefined ? (dto.expiresAt ? new Date(dto.expiresAt) : null) : undefined,
        cost: dto.cost,
        location: dto.location,
        notes: dto.notes,
      },
    });
    await this.events.publish({ userId, eventType: EventType.INGREDIENT_UPDATED, sourceModule: 'food', payload: { id } });
    return updated;
  }

  async deleteIngredient(userId: string, id: string): Promise<{ message: string }> {
    await this.getIngredient(userId, id);
    await this.prisma.ingredient.delete({ where: { id } });
    await this.events.publish({ userId, eventType: EventType.INGREDIENT_DELETED, sourceModule: 'food', payload: { id } });
    return { message: 'Ingredient deleted' };
  }

  async purchaseIngredient(userId: string, id: string, dto: PurchaseIngredientDto) {
    const ingredient = await this.getIngredient(userId, id);

    const updated = await this.prisma.ingredient.update({
      where: { id },
      data: {
        purchasedAt: new Date(),
        cost: dto.cost ?? ingredient.cost,
      },
    });

    // Optionally create a Finance expense record
    if (dto.createExpense && dto.cost && dto.cost > 0) {
      try {
        const foodCategory = await this.prisma.expenseCategory.findFirst({
          where: { type: ExpenseCategoryType.FOOD, isDefault: true },
        });
        await this.prisma.expense.create({
          data: {
            userId,
            categoryId: foodCategory?.id ?? null,
            amount: dto.cost,
            currency: 'TWD',
            expenseDate: new Date(),
            paymentMethod: PaymentMethod.CASH,
            sourceModule: 'food',
            sourceEntityId: id,
            note: dto.note ?? `Mua ${ingredient.name}`,
          },
        });
      } catch (err) {
        this.logger.warn('Failed to create finance expense for ingredient purchase', err);
      }
    }

    await this.events.publish({
      userId,
      eventType: EventType.INGREDIENT_PURCHASED,
      sourceModule: 'food',
      payload: { id, name: ingredient.name, cost: dto.cost },
    });

    return updated;
  }

  // ─── Recipes ──────────────────────────────────────────────────────────────

  async getRecipes(userId: string) {
    return this.prisma.recipe.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRecipe(userId: string, id: string) {
    const recipe = await this.prisma.recipe.findFirst({ where: { id, userId } });
    if (!recipe) throw new NotFoundException('Recipe not found');
    return recipe;
  }

  async createRecipe(userId: string, dto: CreateRecipeDto) {
    const recipe = await this.prisma.recipe.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        servings: dto.servings ?? 1,
        prepMinutes: dto.prepMinutes ?? 0,
        cookMinutes: dto.cookMinutes ?? 0,
        isPublic: dto.isPublic ?? false,
        isAiGenerated: dto.isAiGenerated ?? false,
        aiReason: dto.aiReason,
        category: dto.category,
        ingredientsJson: (dto.ingredientsJson as unknown) as Prisma.InputJsonValue,
        stepsJson: (dto.stepsJson as unknown) as Prisma.InputJsonValue,
        tagsJson: dto.tagsJson ? ((dto.tagsJson as unknown) as Prisma.InputJsonValue) : null,
        missingIngredients: dto.missingIngredients ? ((dto.missingIngredients as unknown) as Prisma.InputJsonValue) : null,
        nutritionJson: dto.nutritionJson ? ((dto.nutritionJson as unknown) as Prisma.InputJsonValue) : null,
        imageUrl: dto.imageUrl,
        source: dto.source,
      },
    });
    await this.events.publish({ userId, eventType: EventType.RECIPE_CREATED, sourceModule: 'food', payload: { id: recipe.id, title: recipe.title } });
    return recipe;
  }

  async updateRecipe(userId: string, id: string, dto: UpdateRecipeDto) {
    await this.getRecipe(userId, id);
    const updated = await this.prisma.recipe.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        servings: dto.servings,
        prepMinutes: dto.prepMinutes,
        cookMinutes: dto.cookMinutes,
        isPublic: dto.isPublic,
        isAiGenerated: dto.isAiGenerated,
        aiReason: dto.aiReason,
        category: dto.category,
        ingredientsJson: dto.ingredientsJson ? ((dto.ingredientsJson as unknown) as Prisma.InputJsonValue) : undefined,
        stepsJson: dto.stepsJson ? ((dto.stepsJson as unknown) as Prisma.InputJsonValue) : undefined,
        tagsJson: dto.tagsJson ? ((dto.tagsJson as unknown) as Prisma.InputJsonValue) : undefined,
        missingIngredients: dto.missingIngredients ? ((dto.missingIngredients as unknown) as Prisma.InputJsonValue) : undefined,
        nutritionJson: dto.nutritionJson ? ((dto.nutritionJson as unknown) as Prisma.InputJsonValue) : undefined,
        imageUrl: dto.imageUrl !== undefined ? dto.imageUrl : undefined,
        source: dto.source !== undefined ? dto.source : undefined,
      },
    });
    await this.events.publish({ userId, eventType: EventType.RECIPE_UPDATED, sourceModule: 'food', payload: { id } });
    return updated;
  }

  async deleteRecipe(userId: string, id: string): Promise<{ message: string }> {
    await this.getRecipe(userId, id);
    await this.prisma.recipe.delete({ where: { id } });
    await this.events.publish({ userId, eventType: EventType.RECIPE_DELETED, sourceModule: 'food', payload: { id } });
    return { message: 'Recipe deleted' };
  }

  async getRecipeRecommendations(userId: string) {
    const [ingredients, recipes] = await Promise.all([
      this.prisma.ingredient.findMany({
        where: {
          userId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          quantity: { gt: 0 },
        },
      }),
      this.prisma.recipe.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);

    const ownedNames = new Set(ingredients.map((i) => i.name.toLowerCase().trim()));

    const scored = recipes.map((recipe) => {
      const items = recipe.ingredientsJson as { name: string }[];
      if (!Array.isArray(items) || items.length === 0) return { recipe, matchCount: 0, matchRate: 0 };
      const matched = items.filter((i) => ownedNames.has((i.name ?? '').toLowerCase().trim())).length;
      return { recipe, matchCount: matched, matchRate: Math.round((matched / items.length) * 100) };
    });

    return scored
      .filter((s) => s.matchRate > 0)
      .sort((a, b) => b.matchRate - a.matchRate)
      .slice(0, 10)
      .map((s) => ({ ...s.recipe, matchCount: s.matchCount, matchRate: s.matchRate }));
  }

  // ─── Meal Plans ───────────────────────────────────────────────────────────

  async getMealPlans(userId: string, date?: string) {
    let start: Date;
    let end: Date;
    if (date) {
      start = new Date(date);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
    } else {
      start = new Date();
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
    }
    return this.prisma.mealPlan.findMany({
      where: { userId, planDate: { gte: start, lt: end } },
      include: { recipe: { select: { id: true, title: true, prepMinutes: true, cookMinutes: true, servings: true } } },
      orderBy: [{ planDate: 'asc' }, { mealType: 'asc' }],
    });
  }

  async createMealPlan(userId: string, dto: CreateMealPlanDto) {
    if (dto.recipeId) {
      const recipe = await this.prisma.recipe.findFirst({ where: { id: dto.recipeId, userId } });
      if (!recipe) throw new NotFoundException('Recipe not found');
    }
    const plan = await this.prisma.mealPlan.create({
      data: {
        userId,
        planDate: new Date(dto.planDate),
        mealType: dto.mealType,
        recipeId: dto.recipeId,
        customMeal: dto.customMeal,
        servings: dto.servings ?? 1,
        notes: dto.notes,
        isAiGenerated: dto.isAiGenerated ?? false,
        aiReason: dto.aiReason,
      },
      include: { recipe: { select: { id: true, title: true } } },
    });
    await this.events.publish({ userId, eventType: EventType.MEAL_PLAN_CREATED, sourceModule: 'food', payload: { id: plan.id, date: dto.planDate } });
    return plan;
  }

  async updateMealPlan(userId: string, id: string, dto: UpdateMealPlanDto) {
    const plan = await this.prisma.mealPlan.findFirst({ where: { id, userId } });
    if (!plan) throw new NotFoundException('Meal plan not found');
    const updated = await this.prisma.mealPlan.update({
      where: { id },
      data: {
        recipeId: dto.recipeId,
        customMeal: dto.customMeal,
        servings: dto.servings,
        notes: dto.notes,
      },
      include: { recipe: { select: { id: true, title: true } } },
    });
    await this.events.publish({ userId, eventType: EventType.MEAL_PLAN_UPDATED, sourceModule: 'food', payload: { id } });
    return updated;
  }

  async deleteMealPlan(userId: string, id: string): Promise<{ message: string }> {
    const plan = await this.prisma.mealPlan.findFirst({ where: { id, userId } });
    if (!plan) throw new NotFoundException('Meal plan not found');
    await this.prisma.mealPlan.delete({ where: { id } });
    await this.events.publish({ userId, eventType: EventType.MEAL_PLAN_DELETED, sourceModule: 'food', payload: { id } });
    return { message: 'Meal plan deleted' };
  }

  // ─── Shopping Lists ───────────────────────────────────────────────────────

  async getShoppingLists(userId: string) {
    return this.prisma.shoppingList.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getShoppingList(userId: string, id: string) {
    const list = await this.prisma.shoppingList.findFirst({
      where: { id, userId },
      include: { items: { orderBy: [{ isPurchased: 'asc' }, { ingredientName: 'asc' }] } },
    });
    if (!list) throw new NotFoundException('Shopping list not found');
    return list;
  }

  async createShoppingList(userId: string, dto: CreateShoppingListDto) {
    const list = await this.prisma.shoppingList.create({
      data: { userId, name: dto.name, notes: dto.notes },
      include: { items: true },
    });
    await this.events.publish({ userId, eventType: EventType.SHOPPING_LIST_CREATED, sourceModule: 'food', payload: { id: list.id } });
    return list;
  }

  async updateShoppingList(userId: string, id: string, dto: UpdateShoppingListDto) {
    await this.getShoppingList(userId, id);
    const updated = await this.prisma.shoppingList.update({
      where: { id },
      data: { name: dto.name, notes: dto.notes },
      include: { items: true },
    });
    await this.events.publish({ userId, eventType: EventType.SHOPPING_LIST_UPDATED, sourceModule: 'food', payload: { id } });
    return updated;
  }

  async deleteShoppingList(userId: string, id: string): Promise<{ message: string }> {
    await this.getShoppingList(userId, id);
    await this.prisma.shoppingList.delete({ where: { id } });
    await this.events.publish({ userId, eventType: EventType.SHOPPING_LIST_DELETED, sourceModule: 'food', payload: { id } });
    return { message: 'Shopping list deleted' };
  }

  async generateShoppingList(userId: string, id: string, dto: GenerateShoppingListDto) {
    await this.getShoppingList(userId, id);

    const weekStart = new Date(dto.weekStartDate);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const mealPlans = await this.prisma.mealPlan.findMany({
      where: { userId, planDate: { gte: weekStart, lt: weekEnd }, recipeId: { not: null } },
      include: { recipe: true },
    });

    // Aggregate needed ingredients from all recipes in the meal plan
    const needed = new Map<string, { quantity: number; unit: string }>();
    for (const plan of mealPlans) {
      if (!plan.recipe) continue;
      const items = plan.recipe.ingredientsJson as { name: string; quantity: number; unit: string }[];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const key = item.name.toLowerCase().trim();
        const existing = needed.get(key);
        const qty = (item.quantity ?? 1) * (plan.servings ?? 1);
        if (existing) {
          existing.quantity += qty;
        } else {
          needed.set(key, { quantity: qty, unit: item.unit ?? 'PIECE' });
        }
      }
    }

    // Find what user already has with sufficient quantity
    const available = await this.prisma.ingredient.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        quantity: { gt: 0 },
      },
    });
    const ownedMap = new Map(available.map((i) => [i.name.toLowerCase().trim(), parseFloat(i.quantity.toString())]));

    // Build shopping items for what's missing or insufficient
    const itemsToCreate: { ingredientName: string; quantity: number; unit: string }[] = [];
    for (const [name, need] of needed.entries()) {
      const owned = ownedMap.get(name) ?? 0;
      const missing = need.quantity - owned;
      if (missing > 0) {
        itemsToCreate.push({ ingredientName: name, quantity: missing, unit: need.unit });
      }
    }

    if (itemsToCreate.length > 0) {
      await this.prisma.shoppingListItem.createMany({
        data: itemsToCreate.map((i) => ({
          shoppingListId: id,
          ingredientName: i.ingredientName,
          quantity: i.quantity,
          unit: (i.unit as Parameters<typeof this.prisma.shoppingListItem.create>[0]['data']['unit']) ?? 'PIECE',
        })),
      });
    }

    await this.events.publish({ userId, eventType: EventType.SHOPPING_LIST_UPDATED, sourceModule: 'food', payload: { id, generatedItems: itemsToCreate.length } });

    return this.getShoppingList(userId, id);
  }

  async toggleShoppingItem(userId: string, listId: string, itemId: string, isPurchased: boolean) {
    const list = await this.prisma.shoppingList.findFirst({ where: { id: listId, userId } });
    if (!list) throw new NotFoundException('Shopping list not found');

    const item = await this.prisma.shoppingListItem.findFirst({ where: { id: itemId, shoppingListId: listId } });
    if (!item) throw new NotFoundException('Shopping list item not found');

    const updated = await this.prisma.shoppingListItem.update({
      where: { id: itemId },
      data: { isPurchased },
    });

    // If all items are purchased, auto-complete the list
    const remaining = await this.prisma.shoppingListItem.count({ where: { shoppingListId: listId, isPurchased: false } });
    if (remaining === 0 && list.status === 'ACTIVE') {
      await this.prisma.shoppingList.update({ where: { id: listId }, data: { status: ShoppingListStatus.COMPLETED } });
      await this.events.publish({ userId, eventType: EventType.SHOPPING_LIST_COMPLETED, sourceModule: 'food', payload: { id: listId } });
    }

    return updated;
  }

  async completeShoppingList(userId: string, id: string) {
    await this.getShoppingList(userId, id);
    const updated = await this.prisma.shoppingList.update({
      where: { id },
      data: { status: ShoppingListStatus.COMPLETED },
      include: { items: true },
    });
    await this.events.publish({ userId, eventType: EventType.SHOPPING_LIST_COMPLETED, sourceModule: 'food', payload: { id } });
    return updated;
  }

  async addShoppingItem(userId: string, listId: string, dto: AddShoppingItemDto) {
    await this.getShoppingList(userId, listId);
    const item = await this.prisma.shoppingListItem.create({
      data: {
        shoppingListId: listId,
        ingredientName: dto.ingredientName,
        quantity: dto.quantity ?? 1,
        unit: (dto.unit as Parameters<typeof this.prisma.shoppingListItem.create>[0]['data']['unit']) ?? 'PIECE',
        notes: dto.notes,
      },
    });
    await this.events.publish({ userId, eventType: EventType.SHOPPING_LIST_UPDATED, sourceModule: 'food', payload: { id: listId } });
    return item;
  }

  // ─── AI: Ingredient Camera Scan ───────────────────────────────────────────

  async scanIngredient(userId: string, dto: ScanIngredientDto) {
    const mimeType = dto.mimeType ?? 'image/jpeg';
    // Strip data URI prefix if present
    const base64 = dto.imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const prompt = `You are analyzing a food/ingredient image. Respond with a JSON object only (no markdown, no explanation).

Analyze this image and return:
{
  "isFood": boolean,           // true if this contains food, ingredient, grocery item, packaged food
  "name": string,              // detected ingredient/food name in English (e.g. "Carrot", "Chicken breast", "Milk")
  "nameVi": string,            // Vietnamese name
  "category": string,          // one of: VEGETABLE, FRUIT, MEAT, SEAFOOD, DAIRY, GRAIN, LEGUME, CONDIMENT, BEVERAGE, SNACK, FROZEN, OTHER
  "quantity": number | null,   // detected quantity if visible, else null
  "unit": string,              // one of: GRAM, KG, ML, LITER, PIECE, PACK, CAN, BOTTLE, BOX, TABLESPOON, TEASPOON, CUP, OTHER
  "ocrExpiryText": string | null,  // raw OCR text for expiry date if found on packaging
  "expiryDate": string | null,     // normalized ISO date YYYY-MM-DD if expiry found via OCR
  "expirySource": string,          // "ocr" if OCR found date, "ai_estimated" if AI estimated, "manual" if not determinable
  "freshnessStatus": string | null, // "fresh", "good", "aging", "near_expiry", "expired" if no OCR date
  "estimatedDaysRemaining": number | null, // AI estimate of days remaining if no OCR date
  "aiConfidence": number,       // 0-100 confidence in the food identification
  "reason": string             // brief reason/description
}

If the image is NOT food-related (e.g. a person, furniture, random object), set isFood to false and fill other fields with null/"OTHER".`;

    const raw = await this.aiChain.generateTextWithVision(base64, mimeType, prompt);

    // Deterministic fallback when no API key
    if (!raw) {
      return {
        isFood: false,
        name: '',
        nameVi: '',
        category: 'OTHER',
        quantity: null,
        unit: 'PIECE',
        ocrExpiryText: null,
        expiryDate: null,
        expirySource: 'manual',
        freshnessStatus: null,
        estimatedDaysRemaining: null,
        aiConfidence: 0,
        reason: 'AI không khả dụng. Vui lòng nhập thủ công.',
        fallback: true,
      };
    }

    const result = this.safeJson<Record<string, unknown>>(raw, { isFood: false, aiConfidence: 0, reason: 'Không thể phân tích ảnh' });
    return {
      ...result,
      category: this.normalizeEnumValue(result.category, Object.values(FoodCategory), FoodCategory.OTHER),
      unit: this.normalizeEnumValue(result.unit, Object.values(UnitOfMeasure), UnitOfMeasure.PIECE),
    };
  }

  // ─── AI: Recipe Generation ────────────────────────────────────────────────

  async generateRecipes(userId: string, dto: GenerateRecipesDto) {
    const expiryDays = dto.expiryPriorityDays ?? 7;
    const count = Math.min(dto.count ?? 3, 5);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + expiryDays);

    const [allIngredients, expiringIngredients] = await Promise.all([
      this.prisma.ingredient.findMany({
        where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], quantity: { gt: 0 } },
        orderBy: [{ expiresAt: 'asc' }],
        take: 30,
      }),
      this.prisma.ingredient.findMany({
        where: { userId, expiresAt: { not: null, lte: cutoff }, quantity: { gt: 0 } },
        orderBy: { expiresAt: 'asc' },
      }),
    ]);

    const ingredientList = allIngredients.map((i) => ({
      name: i.name,
      category: i.category,
      quantity: parseFloat(i.quantity.toString()),
      unit: i.unit,
      expiresAt: i.expiresAt?.toISOString().slice(0, 10) ?? null,
      isExpiringSoon: expiringIngredients.some((e) => e.id === i.id),
    }));

    const hasInventory = ingredientList.length > 0;

    const responseSchema = `[
  {
    "title": string,           // Vietnamese dish name (also add English in parentheses)
    "description": string,     // 1-2 sentence description in Vietnamese
    "category": string,        // VEGETABLE, MEAT, SEAFOOD, DAIRY, GRAIN, OTHER
    "servings": number,
    "prepMinutes": number,
    "cookMinutes": number,
    "ingredientsJson": [       // ingredients to use
      { "name": string, "quantity": number, "unit": string }
    ],
    "missingIngredients": [string],  // ingredients needed that aren't in the user's inventory
    "stepsJson": [
      { "step": number, "description": string }  // Vietnamese instructions
    ],
    "nutritionJson": {
      "calories": number,      // per serving estimate
      "protein": string,
      "carbs": string,
      "fat": string
    },
    "aiReason": string,        // why this recipe is a good fit (Vietnamese)
    "tagsJson": [string]
  }
]`;

    const prompt = hasInventory
      ? `You are a Vietnamese home cooking AI assistant. Generate ${count} practical recipe suggestions that prioritize using the ingredients the user already has, to maximize ingredient usage and minimize food waste.

Available ingredients:
${JSON.stringify(ingredientList, null, 2)}

PRIORITY: Use ingredients marked as isExpiringSoon=true first. It's fine for a recipe to need a few extra ingredients the user doesn't have — list those honestly in missingIngredients rather than refusing to suggest the recipe.

Return a JSON array of ${count} recipes:
${responseSchema}

Rules:
- Prioritize recipes that maximize use of the available ingredients above and minimize food waste
- List any ingredient NOT in the available list in missingIngredients — suggesting a recipe with 1-2 extra items is fine
- Use Vietnamese for descriptions and instructions
- Keep instructions practical and specific
- Prefer recipes using expiring ingredients`
      : `You are a Vietnamese home cooking AI assistant. The user has no ingredients logged in their inventory yet. Generate ${count} popular, practical Vietnamese home-cooking recipes that most households can make with common pantry staples.

Return a JSON array of ${count} recipes:
${responseSchema}

Rules:
- Suggest broadly popular, approachable Vietnamese dishes — these are general suggestions, not based on any specific inventory
- List the realistic ingredients each dish needs in ingredientsJson, and also copy them into missingIngredients since the user has none logged
- Use Vietnamese for descriptions and instructions
- Keep instructions practical and specific`;

    const raw = await this.aiChain.generateText(prompt);
    const ownedNames = ingredientList.map((i) => i.name);

    const finalize = (recipes: Record<string, unknown>[], isAiGenerated: boolean) =>
      recipes.map((r) => ({
        ...r,
        isAiGenerated,
        basedOnInventory: hasInventory,
        imageUrl: RECIPE_CATEGORY_IMAGES[r.category as string] ?? RECIPE_CATEGORY_IMAGES['OTHER'],
        matchRate: hasInventory ? this.calcMatchRate(r.ingredientsJson as { name: string }[], ownedNames) : undefined,
      }));

    if (!raw) {
      // Deterministic fallback (AI unavailable)
      return finalize(this.deterministicRecipeSuggestions(ingredientList, count), false);
    }

    const recipes = this.safeJson<Record<string, unknown>[]>(raw, []);
    if (!Array.isArray(recipes) || recipes.length === 0) {
      return finalize(this.deterministicRecipeSuggestions(ingredientList, count), false);
    }

    return finalize(recipes, true);
  }

  private static readonly GENERIC_RECIPES: Array<Record<string, unknown>> = [
    {
      title: 'Cơm chiên trứng (Egg Fried Rice)',
      description: 'Món cơm chiên đơn giản, nhanh gọn, phù hợp cho mọi bữa ăn.',
      category: 'GRAIN',
      servings: 2, prepMinutes: 10, cookMinutes: 10,
      ingredientsJson: [
        { name: 'Cơm nguội', quantity: 2, unit: 'CUP' },
        { name: 'Trứng', quantity: 2, unit: 'PIECE' },
        { name: 'Hành lá', quantity: 1, unit: 'PIECE' },
      ],
      stepsJson: [
        { step: 1, description: 'Đánh tan trứng, phi thơm hành.' },
        { step: 2, description: 'Cho cơm nguội vào xào đều tay trên lửa lớn.' },
        { step: 3, description: 'Nêm nước mắm, hạt nêm vừa ăn, rắc hành lá.' },
      ],
      nutritionJson: { calories: 380, protein: '10g', carbs: '58g', fat: '10g' },
      tagsJson: ['quick', 'easy'],
    },
    {
      title: 'Canh rau củ thập cẩm (Mixed Vegetable Soup)',
      description: 'Canh thanh đạm, dễ nấu với rau củ thông dụng.',
      category: 'VEGETABLE',
      servings: 3, prepMinutes: 10, cookMinutes: 20,
      ingredientsJson: [
        { name: 'Cà rốt', quantity: 1, unit: 'PIECE' },
        { name: 'Khoai tây', quantity: 1, unit: 'PIECE' },
        { name: 'Hành tây', quantity: 1, unit: 'PIECE' },
      ],
      stepsJson: [
        { step: 1, description: 'Gọt vỏ, thái miếng vừa ăn các loại rau củ.' },
        { step: 2, description: 'Đun sôi nước, cho rau củ vào nấu chín mềm.' },
        { step: 3, description: 'Nêm gia vị vừa ăn, rắc hành ngò và tắt bếp.' },
      ],
      nutritionJson: { calories: 180, protein: '4g', carbs: '30g', fat: '2g' },
      tagsJson: ['light', 'easy'],
    },
    {
      title: 'Trứng chiên hành (Scallion Fried Egg)',
      description: 'Món trứng chiên quen thuộc, nhanh chóng và đủ chất.',
      category: 'DAIRY',
      servings: 2, prepMinutes: 5, cookMinutes: 8,
      ingredientsJson: [
        { name: 'Trứng', quantity: 3, unit: 'PIECE' },
        { name: 'Hành lá', quantity: 1, unit: 'PIECE' },
      ],
      stepsJson: [
        { step: 1, description: 'Đánh tan trứng với hành lá thái nhỏ, nêm chút muối.' },
        { step: 2, description: 'Làm nóng dầu, đổ trứng vào chiên vàng đều hai mặt.' },
      ],
      nutritionJson: { calories: 220, protein: '14g', carbs: '2g', fat: '17g' },
      tagsJson: ['quick', 'easy'],
    },
    {
      title: 'Mì xào thập cẩm (Mixed Stir-fried Noodles)',
      description: 'Mì xào đơn giản với rau củ và trứng, no bụng và dễ làm.',
      category: 'GRAIN',
      servings: 2, prepMinutes: 10, cookMinutes: 12,
      ingredientsJson: [
        { name: 'Mì trứng', quantity: 2, unit: 'PACK' },
        { name: 'Cà rốt', quantity: 1, unit: 'PIECE' },
        { name: 'Trứng', quantity: 1, unit: 'PIECE' },
      ],
      stepsJson: [
        { step: 1, description: 'Trụng mì qua nước sôi cho chín tới, để ráo.' },
        { step: 2, description: 'Xào rau củ và trứng, sau đó cho mì vào đảo đều.' },
        { step: 3, description: 'Nêm nước tương, tiêu vừa ăn.' },
      ],
      nutritionJson: { calories: 420, protein: '14g', carbs: '60g', fat: '12g' },
      tagsJson: ['filling', 'easy'],
    },
  ];

  private deterministicRecipeSuggestions(
    ingredients: { name: string; category: string }[],
    count: number,
  ): Record<string, unknown>[] {
    if (ingredients.length === 0) {
      return FoodService.GENERIC_RECIPES.slice(0, count).map((r) => ({
        ...r,
        missingIngredients: (r.ingredientsJson as { name: string }[]).map((i) => i.name),
        aiReason: 'Gợi ý món phổ biến, dễ làm — bạn chưa có nguyên liệu nào trong tủ.',
      }));
    }

    const names = ingredients.map((i) => i.name);
    const primary = names.slice(0, 3);
    const category = ingredients[0].category ?? 'OTHER';
    const toIngredients = (list: string[]) => list.map((name) => ({ name, quantity: 1, unit: 'PIECE' }));

    const templates = [
      {
        title: `Món xào ${primary[0]} (Stir-fried ${primary[0]})`,
        description: `Xào nhanh với ${primary.join(', ')} — tận dụng tối đa nguyên liệu đang có.`,
        prepMinutes: 10, cookMinutes: 12,
        stepsJson: [
          { step: 1, description: `Sơ chế và thái nhỏ ${primary.join(', ')}.` },
          { step: 2, description: 'Phi thơm tỏi, cho nguyên liệu vào xào trên lửa lớn.' },
          { step: 3, description: 'Nêm nước mắm, hạt nêm vừa ăn rồi tắt bếp.' },
        ],
        calories: 350,
      },
      {
        title: `Canh ${primary[0]} (${primary[0]} Soup)`,
        description: `Canh thanh đạm nấu cùng ${primary.join(', ')}.`,
        prepMinutes: 10, cookMinutes: 20,
        stepsJson: [
          { step: 1, description: `Sơ chế ${primary.join(', ')}, đun sôi nước.` },
          { step: 2, description: 'Cho nguyên liệu vào nấu chín mềm.' },
          { step: 3, description: 'Nêm gia vị vừa ăn, rắc hành ngò và tắt bếp.' },
        ],
        calories: 220,
      },
      {
        title: `Cơm trộn ${primary[0]} (${primary[0]} Rice Bowl)`,
        description: `Cơm trộn dinh dưỡng với ${primary.join(', ')} có sẵn.`,
        prepMinutes: 10, cookMinutes: 15,
        stepsJson: [
          { step: 1, description: `Nấu chín ${primary.join(', ')} theo khẩu vị.` },
          { step: 2, description: 'Trộn đều với cơm trắng nóng.' },
          { step: 3, description: 'Rưới nước mắm hoặc sốt yêu thích lên trên.' },
        ],
        calories: 450,
      },
    ];

    return templates.slice(0, count).map((t) => ({
      title: t.title,
      description: t.description,
      category,
      servings: 2,
      prepMinutes: t.prepMinutes,
      cookMinutes: t.cookMinutes,
      ingredientsJson: toIngredients(primary),
      missingIngredients: ['nước mắm', 'tỏi', 'dầu ăn'],
      stepsJson: t.stepsJson,
      nutritionJson: { calories: t.calories, protein: '12g', carbs: '35g', fat: '10g' },
      aiReason: `Tận dụng ${primary.length} nguyên liệu bạn đang có (${primary.join(', ')}), hạn chế lãng phí thực phẩm.`,
      tagsJson: ['quick', 'easy'],
    }));
  }

  private calcMatchRate(recipeIngredients: { name: string }[] | unknown, owned: string[]): number {
    if (!Array.isArray(recipeIngredients) || recipeIngredients.length === 0) return 0;
    const ownedLower = new Set(owned.map((n) => n.toLowerCase().trim()));
    const matched = recipeIngredients.filter((i) => ownedLower.has((i.name ?? '').toLowerCase().trim())).length;
    return Math.round((matched / recipeIngredients.length) * 100);
  }

  // ─── AI: Meal Slot Suggestion ─────────────────────────────────────────────

  private static readonly FALLBACK_MEALS: Record<string, Array<{ mealName: string; description: string; estimatedCalories: number }>> = {
    BREAKFAST: [
      { mealName: 'Cháo trắng với trứng', description: 'Bữa sáng đơn giản, dễ làm và bổ dưỡng.', estimatedCalories: 250 },
      { mealName: 'Bánh mì trứng ốp la', description: 'Nhanh chóng và tiện lợi cho buổi sáng.', estimatedCalories: 320 },
      { mealName: 'Xôi gà', description: 'Xôi dẻo với gà xé phay thơm ngon.', estimatedCalories: 380 },
      { mealName: 'Phở bò', description: 'Phở truyền thống với nước dùng đậm đà.', estimatedCalories: 420 },
      { mealName: 'Bánh cuốn', description: 'Bánh cuốn nhẹ nhàng cho bữa sáng.', estimatedCalories: 280 },
      { mealName: 'Mì gói với trứng', description: 'Bữa sáng nhanh với mì và trứng.', estimatedCalories: 350 },
    ],
    LUNCH: [
      { mealName: 'Cơm trắng với rau xào', description: 'Bữa trưa cân bằng dinh dưỡng.', estimatedCalories: 450 },
      { mealName: 'Cơm gà xối mỡ', description: 'Cơm gà thơm ngon với nước mắm gừng.', estimatedCalories: 520 },
      { mealName: 'Bún bò Huế', description: 'Bún bò cay nồng đặc trưng miền Trung.', estimatedCalories: 480 },
      { mealName: 'Cơm tấm sườn nướng', description: 'Cơm tấm truyền thống với sườn nướng.', estimatedCalories: 560 },
      { mealName: 'Mì xào hải sản', description: 'Mì xào với các loại hải sản tươi.', estimatedCalories: 490 },
      { mealName: 'Bún thịt nướng', description: 'Bún với thịt nướng thơm và rau sống.', estimatedCalories: 440 },
    ],
    DINNER: [
      { mealName: 'Canh rau với thịt', description: 'Bữa tối nhẹ nhàng và bổ dưỡng.', estimatedCalories: 400 },
      { mealName: 'Lẩu thập cẩm', description: 'Lẩu gia đình với rau và hải sản.', estimatedCalories: 550 },
      { mealName: 'Cá kho tộ', description: 'Cá kho đậm đà với nước mắm và tiêu.', estimatedCalories: 420 },
      { mealName: 'Gà hầm sả', description: 'Gà hầm với sả và gia vị thơm.', estimatedCalories: 460 },
      { mealName: 'Tôm rang muối', description: 'Tôm rang giòn với muối và tiêu xanh.', estimatedCalories: 380 },
      { mealName: 'Thịt kho tàu', description: 'Thịt heo kho với trứng cút đậm đà.', estimatedCalories: 500 },
    ],
    SNACK: [
      { mealName: 'Trái cây tươi', description: 'Ăn nhẹ tốt cho sức khỏe.', estimatedCalories: 150 },
      { mealName: 'Sữa chua', description: 'Sữa chua giàu lợi khuẩn tốt cho tiêu hóa.', estimatedCalories: 120 },
      { mealName: 'Bánh quy lúa mì', description: 'Ăn vặt nhẹ nhàng và tiện lợi.', estimatedCalories: 180 },
      { mealName: 'Chè đậu xanh', description: 'Chè đậu xanh mát lành, giải nhiệt.', estimatedCalories: 200 },
      { mealName: 'Hạt điều rang muối', description: 'Ăn vặt giàu dinh dưỡng.', estimatedCalories: 160 },
      { mealName: 'Bánh chuối nướng', description: 'Bánh chuối nướng thơm ngọt.', estimatedCalories: 220 },
    ],
  };

  // ─── AI: Timetable-aware busy detection ───────────────────────────────────

  private async checkBusyDay(userId: string, planDate: string): Promise<{ isBusy: boolean; totalBusyMinutes: number }> {
    try {
      const dayStart = new Date(planDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const [fixedEvents, tasks] = await Promise.all([
        this.prisma.fixedEvent.findMany({
          where: { userId, startTime: { gte: dayStart, lte: dayEnd } },
          select: { startTime: true, endTime: true },
        }),
        this.prisma.task.findMany({
          where: { userId, scheduledStart: { gte: dayStart, lte: dayEnd }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          select: { scheduledStart: true, scheduledEnd: true, estimatedMinutes: true },
        }),
      ]);

      let totalBusyMinutes = 0;
      for (const e of fixedEvents) {
        totalBusyMinutes += (e.endTime.getTime() - e.startTime.getTime()) / 60000;
      }
      for (const t of tasks) {
        if (t.scheduledStart && t.scheduledEnd) {
          totalBusyMinutes += (t.scheduledEnd.getTime() - t.scheduledStart.getTime()) / 60000;
        } else {
          totalBusyMinutes += t.estimatedMinutes ?? 30;
        }
      }

      return { isBusy: totalBusyMinutes > 240, totalBusyMinutes };
    } catch (err) {
      this.logger.warn('Schedule check failed, defaulting to non-busy', err);
      return { isBusy: false, totalBusyMinutes: 0 };
    }
  }

  private getMealTypeConstraints(mealType: string): string {
    const map: Record<string, string> = {
      BREAKFAST: 'Filling and energizing to start the day. Suitable: phở, bánh mì, xôi, cháo, eggs, bread, noodle soups. Target 350–500 kcal. Include protein and carbs.',
      LUNCH: 'Moderate and balanced. Suitable: rice + protein + vegetables, noodle dishes, bánh mì. Target 450–650 kcal. Balance protein, carbs, and vegetables.',
      DINNER: 'LIGHTER than lunch. Focus on vegetables and light protein. Avoid heavy fried or fatty foods. Suitable: vegetable soup, steamed fish, salad with rice, light stir-fry. Target 300–500 kcal.',
      SNACK: 'MUST BE VERY LIGHT. ONLY suitable: fresh fruit, yogurt, nuts, trail mix, light rice cakes, fruit juice, small biscuits, smoothies. STRICTLY FORBIDDEN for snack: hotpot, porridge, rice meals, com tam, bun bo, pho, full dinner/lunch dishes, heavy soups. Maximum 200 kcal.',
    };
    return map[mealType] ?? 'A balanced meal appropriate for the time of day.';
  }

  private buildWeeklyNutritionContext(existingMeals: Array<{ mealType: string; customMeal?: string | null; recipe?: { title?: string | null } | null }>): string {
    if (existingMeals.length === 0) {
      return 'No meals planned yet this week. Begin with a nutritionally complete and balanced meal.';
    }
    const byType: Record<string, number> = { BREAKFAST: 0, LUNCH: 0, DINNER: 0, SNACK: 0 };
    for (const m of existingMeals) byType[m.mealType] = (byType[m.mealType] ?? 0) + 1;
    const summary = Object.entries(byType).map(([t, c]) => `${t}: ${c}`).join(', ');
    return [
      `Week so far: ${existingMeals.length} meals (${summary}).`,
      'Nutrition goal: Ensure weekly variety across protein sources (meat, fish, eggs, beans), carbohydrates (rice, noodles, bread), fiber (vegetables, fruits), and vitamins.',
      'Pick a meal that FILLS A NUTRITIONAL GAP — if the week has many rice dishes suggest noodles or bread; if low protein suggest a protein-rich option; if few vegetables suggest a vegetable-forward dish.',
    ].join(' ');
  }

  async suggestMeal(userId: string, dto: SuggestMealDto) {
    const planDateObj = new Date(dto.planDate);
    const weekStart = new Date(planDateObj);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [ingredients, existingMeals, scheduleInfo] = await Promise.all([
      this.prisma.ingredient.findMany({
        where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], quantity: { gt: 0 } },
        orderBy: [{ expiresAt: 'asc' }],
        take: 20,
      }),
      this.prisma.mealPlan.findMany({
        where: { userId, planDate: { gte: weekStart, lt: weekEnd } },
        include: { recipe: { select: { title: true } } },
        orderBy: { planDate: 'asc' },
      }),
      this.checkBusyDay(userId, dto.planDate),
    ]);

    const ingredientList = ingredients.map((i) => ({ name: i.name, category: i.category, expiresAt: i.expiresAt?.toISOString().slice(0, 10) ?? null }));

    const slotMealNames = existingMeals
      .filter((m) => m.planDate.toISOString().slice(0, 10) === dto.planDate && m.mealType === dto.mealType)
      .map((m) => m.recipe?.title ?? m.customMeal ?? '')
      .filter(Boolean);

    const clientExcluded: string[] = dto.excludeMeals ?? [];
    const hardExcluded = [...new Set([...slotMealNames, ...clientExcluded])];
    const normalizedHardExcluded = hardExcluded.map((n) => n.trim().toLowerCase());

    const weekMealNames = existingMeals
      .map((m) => m.recipe?.title ?? m.customMeal ?? '')
      .filter((n) => Boolean(n) && !hardExcluded.includes(n));

    const mealTypeVi: Record<string, string> = { BREAKFAST: 'bữa sáng', LUNCH: 'bữa trưa', DINNER: 'bữa tối', SNACK: 'bữa ăn vặt' };
    const mealTypeConstraints = this.getMealTypeConstraints(dto.mealType);
    const weeklyNutritionContext = this.buildWeeklyNutritionContext(existingMeals);

    const busyLine = scheduleInfo.isBusy
      ? `⚠️ BUSY DAY: User has ${Math.round(scheduleInfo.totalBusyMinutes)} min of scheduled activities. Suggest a QUICK meal where prepMinutes + cookMinutes ≤ 20 total.`
      : 'User has free time. Complex or elaborate recipes are fine.';

    const prompt = `You are a Vietnamese nutritionist and chef AI. Suggest ONE ${mealTypeVi[dto.mealType] ?? dto.mealType} meal for ${dto.planDate}.

MEAL TYPE RULES:
${mealTypeConstraints}

SCHEDULE:
${busyLine}

WEEKLY NUTRITION BALANCE:
${weeklyNutritionContext}

AVAILABLE INGREDIENTS (prioritise expiring first):
${JSON.stringify(ingredientList)}

FORBIDDEN — already in this slot or rejected. MUST NOT appear in your suggestion:
${hardExcluded.length ? hardExcluded.join(', ') : 'none'}

Other meals this week (try to avoid repeating):
${weekMealNames.join(', ') || 'none'}

Return ONE JSON object — no markdown, no explanation:
{
  "mealName": string,
  "description": string,
  "category": "VEGETABLE"|"FRUIT"|"MEAT"|"SEAFOOD"|"DAIRY"|"GRAIN"|"LEGUME"|"OTHER",
  "servings": number,
  "prepMinutes": number,
  "cookMinutes": number,
  "ingredientsJson": [{"name": string, "quantity": number, "unit": "GRAM"|"KG"|"ML"|"LITER"|"PIECE"|"TABLESPOON"|"TEASPOON"|"CUP"|"OTHER"}],
  "ingredientsFromInventory": [string],
  "missingIngredients": [string],
  "stepsJson": [{"step": number, "description": string}],
  "nutritionSummary": string,
  "nutritionJson": {"calories": number, "protein": string, "carbs": string, "fat": string, "fiber": string},
  "aiReason": string,
  "estimatedCalories": number
}`;

    const raw = await this.aiChain.generateText(prompt);

    if (!raw) {
      return { ...this.deterministicMealSuggestion(dto.mealType, ingredientList, normalizedHardExcluded), isBusySlot: scheduleInfo.isBusy };
    }

    const suggestion = this.safeJson<Record<string, unknown>>(raw, {});
    if (!suggestion.mealName) {
      return { ...this.deterministicMealSuggestion(dto.mealType, ingredientList, normalizedHardExcluded), isBusySlot: scheduleInfo.isBusy };
    }

    const returnedName = (suggestion.mealName as string).trim().toLowerCase();
    if (normalizedHardExcluded.includes(returnedName)) {
      this.logger.warn(`AI returned forbidden meal "${suggestion.mealName as string}", using deterministic fallback`);
      return { ...this.deterministicMealSuggestion(dto.mealType, ingredientList, normalizedHardExcluded), isBusySlot: scheduleInfo.isBusy };
    }

    return { ...suggestion, isAiGenerated: true, planDate: dto.planDate, mealType: dto.mealType, isBusySlot: scheduleInfo.isBusy };
  }

  // ─── AI: Accept suggestion — atomically save Recipe + MealPlan ────────────

  async acceptMealSuggestion(userId: string, dto: AcceptMealSuggestionDto) {
    const recipe = await this.prisma.recipe.create({
      data: {
        userId,
        title: dto.mealName,
        description: dto.description ?? null,
        servings: dto.servings ?? 2,
        prepMinutes: dto.prepMinutes ?? 10,
        cookMinutes: dto.cookMinutes ?? 15,
        isPublic: false,
        isAiGenerated: true,
        aiReason: dto.aiReason ?? null,
        category: dto.category ?? 'OTHER',
        ingredientsJson: ((dto.ingredientsJson ?? []) as unknown) as Prisma.InputJsonValue,
        stepsJson: ((dto.stepsJson ?? []) as unknown) as Prisma.InputJsonValue,
        nutritionJson: dto.nutritionJson ? ((dto.nutritionJson as unknown) as Prisma.InputJsonValue) : null,
        missingIngredients: dto.missingIngredients ? ((dto.missingIngredients as unknown) as Prisma.InputJsonValue) : null,
        tagsJson: null,
      },
    });

    const plan = await this.prisma.mealPlan.create({
      data: {
        userId,
        planDate: new Date(dto.planDate),
        mealType: dto.mealType,
        recipeId: recipe.id,
        servings: dto.servings ?? 1,
        isAiGenerated: true,
        aiReason: dto.aiReason ?? null,
        nutritionSummary: dto.nutritionSummary ?? null,
      },
      include: { recipe: { select: { id: true, title: true, prepMinutes: true, cookMinutes: true, servings: true } } },
    });

    await this.events.publish({ userId, eventType: EventType.MEAL_PLAN_CREATED, sourceModule: 'food', payload: { id: plan.id, date: dto.planDate, recipeId: recipe.id } });
    return plan;
  }

  private deterministicMealSuggestion(
    mealType: string,
    ingredients: { name: string }[],
    normalizedExcluded: string[] = [],
  ) {
    const pool = FoodService.FALLBACK_MEALS[mealType] ?? FoodService.FALLBACK_MEALS['LUNCH'];
    const available = pool.filter((m) => !normalizedExcluded.includes(m.mealName.trim().toLowerCase()));
    const meal = available[0] ?? pool[0];

    return {
      mealName: meal.mealName,
      description: meal.description,
      category: 'OTHER',
      servings: 1,
      prepMinutes: 10,
      cookMinutes: 15,
      ingredientsJson: ingredients.slice(0, 2).map((i) => ({ name: i.name, quantity: 1, unit: 'PIECE' })),
      ingredientsFromInventory: ingredients.slice(0, 2).map((i) => i.name),
      missingIngredients: [],
      stepsJson: [{ step: 1, description: 'Chuẩn bị nguyên liệu và nấu theo khẩu vị.' }],
      nutritionSummary: `~${meal.estimatedCalories} kcal`,
      nutritionJson: { calories: meal.estimatedCalories, protein: '10g', carbs: '45g', fat: '8g', fiber: '3g' },
      aiReason: available.length === 0 ? 'Đã gợi ý tất cả các món phổ biến. Đây là gợi ý đầu tiên để bắt đầu lại.' : 'Gợi ý mặc định khi AI không khả dụng.',
      estimatedCalories: meal.estimatedCalories,
      isAiGenerated: false,
      mealType,
    };
  }

  // ─── Nearby Grocery Stores ────────────────────────────────────────────────

  private static readonly OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
  ];

  private static readonly TAIWAN_STORE_PRIORITY: Record<string, number> = {
    '全聯': 10, 'PX Mart': 10, 'PXMart': 10,
    '家樂福': 9, 'Carrefour': 9,
    'Wellcome': 8, '頂好': 8, 'Costco': 8,
    '7-Eleven': 6, '7-11': 6,
    '全家': 6, 'FamilyMart': 6,
    'Hi-Life': 5, '萊爾富': 5, 'OK mart': 5,
  };

  private buildOverpassQuery(lat: number, lng: number, radius: number): string {
    const shopTypes = 'supermarket|convenience|grocery|greengrocer|bakery|butcher|deli|seafood|health_food|department_store';
    return `[out:json][timeout:25];\n(\n  node["shop"~"${shopTypes}"](around:${radius},${lat},${lng});\n  way["shop"~"${shopTypes}"](around:${radius},${lat},${lng});\n  node["amenity"="marketplace"](around:${radius},${lat},${lng});\n  way["amenity"="marketplace"](around:${radius},${lat},${lng});\n);\nout body center qt 30;`;
  }

  async fetchOverpassWithRetry(lat: number, lng: number, radius: number): Promise<OverpassElement[]> {
    const query = this.buildOverpassQuery(lat, lng, radius);
    const body = `data=${encodeURIComponent(query)}`;

    // Race all mirrors in parallel — return first successful response.
    // Timeout < mobile client's 10 s so the backend always replies before the mobile aborts.
    const attempts = FoodService.OVERPASS_MIRRORS.map(async (mirror) => {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { elements: OverpassElement[] };
        const elements = data.elements ?? [];
        this.logger.log(`Overpass OK ${mirror} → ${elements.length} elements`);
        return elements;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
        this.logger.warn(`Overpass FAIL ${mirror} [${code}] ${(err as Error).message}`);
        throw err;
      }
    });

    try {
      return await Promise.any(attempts);
    } catch {
      throw new Error('All Overpass mirrors unavailable');
    }
  }

  private async fetchGooglePlaces(lat: number, lng: number, radius: number, apiKey: string): Promise<OverpassElement[]> {
    const types = ['grocery_or_supermarket', 'convenience_store'];
    const seen = new Set<string>();
    const elements: OverpassElement[] = [];

    for (const type of types) {
      try {
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${type}&key=${apiKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const body = await res.json() as {
          results: Array<{
            place_id: string; name: string; vicinity: string;
            geometry: { location: { lat: number; lng: number } };
            types: string[];
          }>;
        };
        for (const place of body.results ?? []) {
          if (seen.has(place.place_id)) continue;
          seen.add(place.place_id);
          elements.push({
            id: place.place_id,
            lat: place.geometry.location.lat,
            lon: place.geometry.location.lng,
            tags: {
              name: place.name,
              shop: place.types.includes('convenience_store') ? 'convenience' : 'supermarket',
              'addr:street': place.vicinity,
            },
          });
        }
      } catch (err) {
        this.logger.warn(`Google Places type=${type} failed — ${(err as Error).message}`);
      }
    }
    return elements;
  }

  parseOverpassElements(elements: OverpassElement[], userLat: number, userLng: number): StoreResult[] {
    return elements
      .filter((el) => el.tags?.name)
      .map((el) => {
        const lat = el.lat ?? el.center?.lat ?? 0;
        const lng = el.lon ?? el.center?.lon ?? 0;
        const dist = this.haversineDistance(userLat, userLng, lat, lng);
        const shopType = el.tags?.shop ?? el.tags?.amenity ?? 'store';
        return {
          id: el.id,
          name: el.tags?.name ?? '',
          nameZh: el.tags?.['name:zh'] ?? el.tags?.['name:zh-TW'] ?? null,
          type: shopType,
          lat,
          lng,
          distanceMeters: Math.round(dist),
          distanceLabel: dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(1)}km`,
          address: [
            el.tags?.['addr:housenumber'],
            el.tags?.['addr:street'],
            el.tags?.['addr:city'],
          ].filter(Boolean).join(' ') || null,
          openingHours: el.tags?.opening_hours ?? null,
          phone: el.tags?.phone ?? null,
          mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
          osmUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`,
        };
      });
  }

  rankStores(stores: StoreResult[], _query: string, preferredTypes: string[] = []): StoreResult[] {
    const priorityMap = FoodService.TAIWAN_STORE_PRIORITY;
    const scored = stores.map((s) => {
      let score = Math.max(0, 10000 - s.distanceMeters) / 1000; // distance score
      for (const [kw, boost] of Object.entries(priorityMap)) {
        if (s.name.includes(kw) || s.nameZh?.includes(kw)) { score += boost; break; }
      }
      if (preferredTypes.includes(s.type)) score += 3;
      return { store: s, score };
    });
    // Primary: distance asc; secondary: score desc
    scored.sort((a, b) =>
      a.store.distanceMeters !== b.store.distanceMeters
        ? a.store.distanceMeters - b.store.distanceMeters
        : b.score - a.score,
    );
    return scored.map((s) => s.store);
  }

  async nearbyStores(dto: NearbyStoresDto) {
    const radius = dto.radius ?? 3000;
    const { lat, lng, query } = dto;

    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      return { query, lat, lng, radius, count: 0, stores: [], provider: 'none', error: 'Thiếu tọa độ vị trí' };
    }

    // AI: infer store types most likely to carry this ingredient (non-blocking)
    let preferredTypes: string[] = [];
    try {
      const hint = await this.aiChain.generateText(
        `Ingredient: "${query}". Which store types from this list are most likely to sell it? Reply ONLY with a comma-separated list from: supermarket,convenience,greengrocer,grocery,marketplace,butcher,bakery,seafood,health_food. No explanation.`,
      );
      if (hint) preferredTypes = hint.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } catch { /* AI hint is optional */ }

    let rawElements: OverpassElement[] = [];
    let provider = 'overpass';
    let mapProviderError: string | null = null;

    // Provider 1: Google Places (only if key configured)
    const googleKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (googleKey) {
      try {
        rawElements = await this.fetchGooglePlaces(lat, lng, radius, googleKey);
        if (rawElements.length > 0) provider = 'google';
      } catch (err) {
        this.logger.warn('Google Places failed, falling back to Overpass', (err as Error).message);
      }
    }

    // Provider 2: Overpass / OSM (with mirror retry)
    if (rawElements.length === 0) {
      try {
        rawElements = await this.fetchOverpassWithRetry(lat, lng, radius);
        provider = 'overpass';
      } catch (err) {
        this.logger.warn('All map providers failed', (err as Error).message);
        mapProviderError = 'Dịch vụ bản đồ tạm thời không khả dụng';
      }
    }

    const stores = this.rankStores(this.parseOverpassElements(rawElements, lat, lng), query, preferredTypes).slice(0, 15);

    return {
      query,
      lat,
      lng,
      radius,
      count: stores.length,
      stores,
      provider,
      error: stores.length === 0
        ? (mapProviderError ?? 'Không tìm thấy cửa hàng nào trong khu vực này')
        : undefined,
    };
  }

  haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
