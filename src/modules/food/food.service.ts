import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ExpenseCategoryType, MealType, PaymentMethod, Prisma, ShoppingListStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { ConfigService } from '@nestjs/config';

interface OverpassElement {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
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
  NearbyStoresDto,
  AddShoppingItemDto,
} from './dto/food.dto.js';

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);
  private readonly anthropicKey: string | undefined;
  private readonly anthropicModel: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly config: ConfigService,
  ) {
    this.anthropicKey = this.config.get<string>('ANTHROPIC_API_KEY') || undefined;
    this.anthropicModel = this.config.get<string>('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';
  }

  private async callClaude(prompt: string): Promise<string> {
    if (!this.anthropicKey) return '';
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: this.anthropicKey });
      const res = await client.messages.create({
        model: this.anthropicModel,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.content[0]?.type === 'text' ? res.content[0].text : '';
    } catch (err) {
      this.logger.warn('Claude call failed, falling back', err);
      return '';
    }
  }

  private async callClaudeVision(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
    if (!this.anthropicKey) return '';
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: this.anthropicKey });
      const res = await client.messages.create({
        model: this.anthropicModel,
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: imageBase64 } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });
      return res.content[0]?.type === 'text' ? res.content[0].text : '';
    } catch (err) {
      this.logger.warn('Claude vision call failed', err);
      return '';
    }
  }

  private safeJson<T>(text: string, fallback: T): T {
    try {
      const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]) as T;
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
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
            amount: new Prisma.Decimal(dto.cost),
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
        category: dto.category,
        ingredientsJson: (dto.ingredientsJson as unknown) as Prisma.InputJsonValue,
        stepsJson: (dto.stepsJson as unknown) as Prisma.InputJsonValue,
        tagsJson: dto.tagsJson ? ((dto.tagsJson as unknown) as Prisma.InputJsonValue) : Prisma.JsonNull,
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
        category: dto.category,
        ingredientsJson: dto.ingredientsJson ? ((dto.ingredientsJson as unknown) as Prisma.InputJsonValue) : undefined,
        stepsJson: dto.stepsJson ? ((dto.stepsJson as unknown) as Prisma.InputJsonValue) : undefined,
        tagsJson: dto.tagsJson ? ((dto.tagsJson as unknown) as Prisma.InputJsonValue) : undefined,
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
          quantity: new Prisma.Decimal(i.quantity),
          unit: (i.unit as Parameters<typeof this.prisma.shoppingListItem.create>[0]['data']['unit']) ?? 'PIECE',
        })),
        skipDuplicates: true,
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
        quantity: new Prisma.Decimal(dto.quantity ?? 1),
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

    let raw = await this.callClaudeVision(base64, mimeType, prompt);

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
    return result;
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

    if (ingredientList.length === 0) {
      return [];
    }

    const prompt = `You are a Vietnamese home cooking AI assistant. Generate ${count} practical recipe suggestions based on these available ingredients.

Available ingredients:
${JSON.stringify(ingredientList, null, 2)}

PRIORITY: Use ingredients marked as isExpiringSoon=true first to minimize food waste.

Return a JSON array of ${count} recipes:
[
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
    "missingIngredients": [string],  // ingredient names NOT in the available list but needed
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
]

Rules:
- Only suggest recipes that make sense with available ingredients
- Mark missing ingredients honestly in missingIngredients array
- Use Vietnamese for descriptions and instructions
- Keep instructions practical and specific
- Prefer recipes using expiring ingredients`;

    const raw = await this.callClaude(prompt);

    if (!raw) {
      // Deterministic fallback
      return this.deterministicRecipeSuggestions(ingredientList);
    }

    const recipes = this.safeJson<Record<string, unknown>[]>(raw, []);
    if (!Array.isArray(recipes) || recipes.length === 0) {
      return this.deterministicRecipeSuggestions(ingredientList);
    }

    return recipes.map((r) => ({
      ...r,
      isAiGenerated: true,
      matchRate: this.calcMatchRate(r.ingredientsJson as { name: string }[], ingredientList.map((i) => i.name)),
    }));
  }

  private deterministicRecipeSuggestions(ingredients: { name: string; category: string }[]) {
    const hasVeggies = ingredients.some((i) => i.category === 'VEGETABLE');
    const hasMeat = ingredients.some((i) => i.category === 'MEAT' || i.category === 'SEAFOOD');
    const suggestions = [];

    if (hasVeggies || hasMeat) {
      suggestions.push({
        title: 'Cơm chiên rau củ (Fried Rice with Vegetables)',
        description: 'Món cơm chiên đơn giản với rau củ có sẵn, dễ làm và bổ dưỡng.',
        category: 'OTHER',
        servings: 2,
        prepMinutes: 10,
        cookMinutes: 15,
        ingredientsJson: ingredients.slice(0, 3).map((i) => ({ name: i.name, quantity: 1, unit: 'PIECE' })),
        missingIngredients: ['cơm nguội', 'trứng', 'nước mắm'],
        stepsJson: [
          { step: 1, description: 'Chuẩn bị và thái nhỏ các loại rau củ.' },
          { step: 2, description: 'Phi hành tỏi cho thơm rồi cho rau vào xào.' },
          { step: 3, description: 'Cho cơm vào đảo đều, nêm nước mắm vừa ăn.' },
        ],
        nutritionJson: { calories: 350, protein: '12g', carbs: '55g', fat: '8g' },
        aiReason: 'Sử dụng nguyên liệu có sẵn, đơn giản và nhanh chóng.',
        tagsJson: ['quick', 'easy'],
        isAiGenerated: false,
        matchRate: 60,
      });
    }

    return suggestions;
  }

  private calcMatchRate(recipeIngredients: { name: string }[] | unknown, owned: string[]): number {
    if (!Array.isArray(recipeIngredients) || recipeIngredients.length === 0) return 0;
    const ownedLower = new Set(owned.map((n) => n.toLowerCase().trim()));
    const matched = recipeIngredients.filter((i) => ownedLower.has((i.name ?? '').toLowerCase().trim())).length;
    return Math.round((matched / recipeIngredients.length) * 100);
  }

  // ─── AI: Meal Slot Suggestion ─────────────────────────────────────────────

  async suggestMeal(userId: string, dto: SuggestMealDto) {
    const planDateObj = new Date(dto.planDate);
    const weekStart = new Date(planDateObj);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [ingredients, existingMeals] = await Promise.all([
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
    ]);

    const ingredientList = ingredients.map((i) => ({ name: i.name, category: i.category, expiresAt: i.expiresAt?.toISOString().slice(0, 10) ?? null }));
    const existingMealNames = existingMeals.map((m) => m.recipe?.title ?? m.customMeal ?? '').filter(Boolean);

    const mealTypeVi: Record<string, string> = { BREAKFAST: 'bữa sáng', LUNCH: 'bữa trưa', DINNER: 'bữa tối', SNACK: 'bữa ăn vặt' };

    const prompt = `You are a Vietnamese meal planning AI. Suggest ONE ${mealTypeVi[dto.mealType] ?? dto.mealType} meal for ${dto.planDate}.

Available ingredients:
${JSON.stringify(ingredientList)}

Meals already planned this week (avoid repetition):
${existingMealNames.join(', ') || 'none'}

Return a single JSON object:
{
  "mealName": string,           // Vietnamese dish name
  "description": string,        // 1-2 sentences in Vietnamese
  "category": string,           // VEGETABLE, MEAT, SEAFOOD, DAIRY, GRAIN, OTHER
  "servings": number,
  "prepMinutes": number,
  "cookMinutes": number,
  "ingredientsFromInventory": [string],  // ingredient names from the available list
  "missingIngredients": [string],        // what needs to be bought
  "stepsJson": [{ "step": number, "description": string }],
  "nutritionSummary": string,    // e.g. "~450 kcal, 25g đạm"
  "aiReason": string,            // why this meal is suitable (Vietnamese)
  "estimatedCalories": number
}

Rules:
- Must be appropriate for ${dto.mealType} (breakfast = lighter, dinner = heartier)
- Use expiring ingredients when possible
- Do not repeat meals already planned this week
- Keep it practical for Vietnamese home cooking`;

    const raw = await this.callClaude(prompt);

    if (!raw) {
      return this.deterministicMealSuggestion(dto.mealType, ingredientList);
    }

    const suggestion = this.safeJson<Record<string, unknown>>(raw, {});
    if (!suggestion.mealName) {
      return this.deterministicMealSuggestion(dto.mealType, ingredientList);
    }

    return { ...suggestion, isAiGenerated: true, planDate: dto.planDate, mealType: dto.mealType };
  }

  private deterministicMealSuggestion(mealType: string, ingredients: { name: string }[]) {
    const meals: Record<string, Record<string, unknown>> = {
      BREAKFAST: { mealName: 'Cháo trắng với trứng', description: 'Bữa sáng đơn giản, dễ làm và bổ dưỡng.', estimatedCalories: 250 },
      LUNCH: { mealName: 'Cơm trắng với rau xào', description: 'Bữa trưa cân bằng dinh dưỡng.', estimatedCalories: 450 },
      DINNER: { mealName: 'Canh rau với thịt', description: 'Bữa tối nhẹ nhàng và bổ dưỡng.', estimatedCalories: 400 },
      SNACK: { mealName: 'Trái cây tươi', description: 'Ăn nhẹ tốt cho sức khỏe.', estimatedCalories: 150 },
    };
    return {
      ...(meals[mealType] ?? meals['LUNCH']),
      category: 'OTHER',
      servings: 1,
      prepMinutes: 10,
      cookMinutes: 15,
      ingredientsFromInventory: ingredients.slice(0, 2).map((i) => i.name),
      missingIngredients: [],
      stepsJson: [{ step: 1, description: 'Chuẩn bị và nấu theo khẩu vị.' }],
      nutritionSummary: `~${(meals[mealType] as Record<string, number>)?.estimatedCalories ?? 400} kcal`,
      aiReason: 'Gợi ý mặc định khi AI không khả dụng.',
      isAiGenerated: false,
      mealType,
    };
  }

  // ─── Nearby Grocery Stores ────────────────────────────────────────────────

  async nearbyStores(dto: NearbyStoresDto) {
    const radius = dto.radius ?? 3000;
    const query = encodeURIComponent(`${dto.query} supermarket grocery store`);

    // Use Overpass API (OpenStreetMap) for free location search
    const overpassQuery = `
[out:json][timeout:10];
(
  node["shop"~"supermarket|convenience|grocery|greengrocer|bakery|butcher|deli|seafood|health_food"](around:${radius},${dto.lat},${dto.lng});
  way["shop"~"supermarket|convenience|grocery|greengrocer|bakery|butcher|deli|seafood|health_food"](around:${radius},${dto.lat},${dto.lng});
);
out center 15;`;

    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

      const data = await res.json() as { elements: OverpassElement[] };
      const elements: OverpassElement[] = data.elements ?? [];

      const stores = elements
        .filter((el) => el.tags?.name)
        .map((el) => {
          const lat = el.lat ?? el.center?.lat ?? 0;
          const lng = el.lon ?? el.center?.lon ?? 0;
          const dist = this.haversineDistance(dto.lat, dto.lng, lat, lng);
          return {
            id: el.id,
            name: el.tags?.name ?? 'Cửa hàng',
            type: el.tags?.shop ?? 'store',
            lat,
            lng,
            distanceMeters: Math.round(dist),
            distanceLabel: dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(1)}km`,
            address: [el.tags?.['addr:street'], el.tags?.['addr:city']].filter(Boolean).join(', ') || null,
            openingHours: el.tags?.opening_hours ?? null,
            phone: el.tags?.phone ?? null,
            mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
          };
        })
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, 15);

      return {
        query: dto.query,
        lat: dto.lat,
        lng: dto.lng,
        radius,
        count: stores.length,
        stores,
      };
    } catch (err) {
      this.logger.warn('Overpass API failed', err);
      return { query: dto.query, lat: dto.lat, lng: dto.lng, radius, count: 0, stores: [], error: 'Không thể tìm cửa hàng gần đây' };
    }
  }

  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
