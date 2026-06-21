import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ExpenseCategoryType, PaymentMethod, Prisma, ShoppingListStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
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
} from './dto/food.dto.js';

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

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
}
