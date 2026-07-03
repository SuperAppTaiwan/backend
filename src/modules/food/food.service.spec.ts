import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FoodService } from './food.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { AIProviderChain } from '../ai/providers/ai-provider-chain.service.js';
import { FoodCategory, MealType, ShoppingListStatus, UnitOfMeasure } from '@prisma/client';

const USER_ID = 'user-food-test';

const makeIngredient = (overrides = {}) => ({
  id: 'ing-1',
  userId: USER_ID,
  name: 'Cà rốt',
  category: FoodCategory.VEGETABLE,
  unit: UnitOfMeasure.KG,
  quantity: { toString: () => '1.5' },
  expiresAt: new Date(Date.now() + 86400000 * 3),
  purchasedAt: new Date(),
  cost: null,
  location: 'Tủ lạnh',
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeRecipe = (overrides = {}) => ({
  id: 'recipe-1',
  userId: USER_ID,
  title: 'Canh cà rốt',
  description: null,
  servings: 2,
  prepMinutes: 10,
  cookMinutes: 20,
  isPublic: false,
  category: FoodCategory.VEGETABLE,
  ingredientsJson: [
    { name: 'Cà rốt', quantity: 0.5, unit: 'KG' },
    { name: 'Hành tây', quantity: 1, unit: 'PIECE' },
  ],
  stepsJson: [{ step: 1, description: 'Thái cà rốt' }],
  tagsJson: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeShoppingList = (overrides = {}) => ({
  id: 'list-1',
  userId: USER_ID,
  name: 'Danh sách mua sắm tuần này',
  status: ShoppingListStatus.ACTIVE,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [],
  ...overrides,
});

const makeShoppingItem = (overrides = {}) => ({
  id: 'item-1',
  shoppingListId: 'list-1',
  ingredientName: 'Hành tây',
  quantity: { toString: () => '2' },
  unit: UnitOfMeasure.PIECE,
  isPurchased: false,
  estimatedCost: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// Use explicit mock types to avoid jest.Mocked depth issues with new Prisma delegate types
type MockedDelegate = Record<string, jest.Mock>;
type MockedPrisma = Record<string, MockedDelegate>;

describe('FoodService', () => {
  let service: FoodService;
  let prisma: MockedPrisma;
  let eventsService: { publish: jest.Mock };
  let aiChain: { generateText: jest.Mock };

  beforeEach(async () => {
    const mockPrisma = {
      ingredient: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      recipe: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      mealPlan: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      shoppingList: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      shoppingListItem: { findFirst: jest.fn(), createMany: jest.fn(), update: jest.fn(), count: jest.fn() },
      expenseCategory: { findFirst: jest.fn() },
      expense: { create: jest.fn() },
      fixedEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const mockEvents = { publish: jest.fn().mockResolvedValue(undefined) };
    const mockAIChain = { generateText: jest.fn().mockResolvedValue('') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FoodService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        { provide: AIProviderChain, useValue: mockAIChain },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    service = module.get<FoodService>(FoodService);
    prisma = module.get(PrismaService);
    eventsService = module.get(EventsService);
    aiChain = module.get(AIProviderChain) as unknown as { generateText: jest.Mock };
  });

  // ─── Ingredient ────────────────────────────────────────────────────────────

  describe('getIngredients', () => {
    it('returns ingredients for the user', async () => {
      const items = [makeIngredient()];
      prisma.ingredient.findMany.mockResolvedValue(items as never);
      const result = await service.getIngredients(USER_ID);
      expect(result).toEqual(items);
      expect(prisma.ingredient.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: USER_ID } }));
    });
  });

  describe('getExpiringIngredients', () => {
    it('queries with correct date cutoff', async () => {
      prisma.ingredient.findMany.mockResolvedValue([makeIngredient()] as never);
      await service.getExpiringIngredients(USER_ID, 7);
      expect(prisma.ingredient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID }) }),
      );
    });
  });

  describe('getIngredient', () => {
    it('throws NotFoundException when ingredient not found', async () => {
      prisma.ingredient.findFirst.mockResolvedValue(null);
      await expect(service.getIngredient(USER_ID, 'missing-id')).rejects.toThrow(NotFoundException);
    });

    it('returns ingredient when found', async () => {
      const item = makeIngredient();
      prisma.ingredient.findFirst.mockResolvedValue(item as never);
      const result = await service.getIngredient(USER_ID, item.id);
      expect(result).toEqual(item);
    });
  });

  describe('createIngredient', () => {
    it('creates ingredient and publishes event', async () => {
      const item = makeIngredient();
      prisma.ingredient.create.mockResolvedValue(item as never);
      const result = await service.createIngredient(USER_ID, { name: 'Cà rốt' });
      expect(result).toEqual(item);
      expect(eventsService.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'INGREDIENT_CREATED', userId: USER_ID }));
    });
  });

  describe('deleteIngredient', () => {
    it('throws NotFoundException if ingredient does not belong to user', async () => {
      prisma.ingredient.findFirst.mockResolvedValue(null);
      await expect(service.deleteIngredient(USER_ID, 'wrong-id')).rejects.toThrow(NotFoundException);
    });

    it('deletes ingredient and publishes event', async () => {
      const item = makeIngredient();
      prisma.ingredient.findFirst.mockResolvedValue(item as never);
      prisma.ingredient.delete.mockResolvedValue(item as never);
      const result = await service.deleteIngredient(USER_ID, item.id);
      expect(result.message).toBe('Ingredient deleted');
      expect(eventsService.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'INGREDIENT_DELETED' }));
    });
  });

  describe('purchaseIngredient', () => {
    it('marks ingredient as purchased and publishes event', async () => {
      const item = makeIngredient();
      prisma.ingredient.findFirst.mockResolvedValue(item as never);
      prisma.ingredient.update.mockResolvedValue({ ...item, purchasedAt: new Date() } as never);
      await service.purchaseIngredient(USER_ID, item.id, { cost: 30000, createExpense: false });
      expect(prisma.ingredient.update).toHaveBeenCalled();
      expect(eventsService.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'INGREDIENT_PURCHASED' }));
    });

    it('creates finance expense when createExpense is true', async () => {
      const item = makeIngredient();
      prisma.ingredient.findFirst.mockResolvedValue(item as never);
      prisma.ingredient.update.mockResolvedValue({ ...item, purchasedAt: new Date() } as never);
      prisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-food' } as never);
      prisma.expense.create.mockResolvedValue({} as never);
      await service.purchaseIngredient(USER_ID, item.id, { cost: 50000, createExpense: true });
      expect(prisma.expense.create).toHaveBeenCalled();
    });
  });

  // ─── Recipe recommendations ────────────────────────────────────────────────

  describe('getRecipeRecommendations', () => {
    it('ranks recipes by ingredient overlap', async () => {
      const ingredients = [
        makeIngredient({ name: 'Cà rốt', quantity: { toString: () => '1' } }),
        makeIngredient({ id: 'ing-2', name: 'Hành tây', quantity: { toString: () => '2' } }),
      ];
      const recipes = [
        makeRecipe({ id: 'r1', ingredientsJson: [{ name: 'Cà rốt', quantity: 0.5, unit: 'KG' }, { name: 'Hành tây', quantity: 1, unit: 'PIECE' }] }),
        makeRecipe({ id: 'r2', ingredientsJson: [{ name: 'Cà rốt', quantity: 0.3, unit: 'KG' }, { name: 'Tôm', quantity: 100, unit: 'GRAM' }] }),
      ];
      prisma.ingredient.findMany.mockResolvedValue(ingredients as never);
      prisma.recipe.findMany.mockResolvedValue(recipes as never);

      const result = await service.getRecipeRecommendations(USER_ID);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].id).toBe('r1'); // both ingredients matched = 100% > 50%
    });

    it('returns empty array when user has no ingredients', async () => {
      prisma.ingredient.findMany.mockResolvedValue([]);
      prisma.recipe.findMany.mockResolvedValue([makeRecipe()] as never);
      const result = await service.getRecipeRecommendations(USER_ID);
      expect(result).toHaveLength(0);
    });
  });

  // ─── Shopping list ─────────────────────────────────────────────────────────

  describe('toggleShoppingItem', () => {
    it('throws if shopping list not found', async () => {
      prisma.shoppingList.findFirst.mockResolvedValue(null);
      await expect(service.toggleShoppingItem(USER_ID, 'list-x', 'item-x', true)).rejects.toThrow(NotFoundException);
    });

    it('auto-completes list when all items are purchased', async () => {
      const list = makeShoppingList();
      const item = makeShoppingItem();
      prisma.shoppingList.findFirst.mockResolvedValue(list as never);
      prisma.shoppingListItem.findFirst.mockResolvedValue(item as never);
      prisma.shoppingListItem.update.mockResolvedValue({ ...item, isPurchased: true } as never);
      prisma.shoppingListItem.count.mockResolvedValue(0); // 0 remaining
      prisma.shoppingList.update.mockResolvedValue({ ...list, status: ShoppingListStatus.COMPLETED } as never);

      await service.toggleShoppingItem(USER_ID, 'list-1', 'item-1', true);
      expect(prisma.shoppingList.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ShoppingListStatus.COMPLETED } }),
      );
      expect(eventsService.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'SHOPPING_LIST_COMPLETED' }));
    });
  });

  describe('createShoppingList', () => {
    it('creates shopping list and publishes event', async () => {
      const list = makeShoppingList();
      prisma.shoppingList.create.mockResolvedValue(list as never);
      const result = await service.createShoppingList(USER_ID, { name: 'Mua sắm cuối tuần' });
      expect(result).toEqual(list);
      expect(eventsService.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'SHOPPING_LIST_CREATED' }));
    });
  });

  // ─── nearbyStores ──────────────────────────────────────────────────────────

  describe('nearbyStores', () => {
    const USER_LAT = 25.033;
    const USER_LNG = 121.564;

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns error immediately when lat/lng are NaN', async () => {
      const result = await service.nearbyStores({ query: 'milk', lat: NaN, lng: NaN });
      expect(result.count).toBe(0);
      expect(result.error).toBeDefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns stores sorted by distance when Overpass succeeds', async () => {
      const elements = [
        { id: 1, lat: 25.040, lon: 121.564, tags: { name: 'Far Market', shop: 'supermarket' } },
        { id: 2, lat: 25.034, lon: 121.564, tags: { name: 'Close PX Mart', shop: 'supermarket' } },
      ];
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ elements }) });

      const result = await service.nearbyStores({ query: 'milk', lat: USER_LAT, lng: USER_LNG, radius: 3000 });
      expect(result.count).toBeGreaterThan(0);
      expect(result.provider).toBe('overpass');
      expect(result.stores[0].distanceMeters).toBeLessThanOrEqual(result.stores[result.stores.length - 1].distanceMeters);
    });

    it('tries second Overpass mirror when first fails', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ elements: [{ id: 3, lat: 25.033, lon: 121.565, tags: { name: 'Nearby Store', shop: 'grocery' } }] }),
        });

      const result = await service.nearbyStores({ query: 'carrot', lat: USER_LAT, lng: USER_LNG });
      expect(result.count).toBe(1);
      expect(result.stores[0].name).toBe('Nearby Store');
    });

    it('returns empty stores with error message when all Overpass mirrors fail', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network unreachable'));

      const result = await service.nearbyStores({ query: 'milk', lat: USER_LAT, lng: USER_LNG });
      expect(result.count).toBe(0);
      expect(result.stores).toHaveLength(0);
      expect(result.error).toMatch(/tạm thời/);
    });

    it('excludes unnamed elements from results', async () => {
      const elements = [
        { id: 1, lat: USER_LAT, lon: USER_LNG, tags: { shop: 'supermarket' } }, // no name
        { id: 2, lat: USER_LAT, lon: USER_LNG + 0.001, tags: { name: 'Named Store', shop: 'grocery' } },
      ];
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ elements }) });

      const result = await service.nearbyStores({ query: 'eggs', lat: USER_LAT, lng: USER_LNG });
      expect(result.count).toBe(1);
      expect(result.stores[0].name).toBe('Named Store');
    });

    it('returns osmUrl and mapsUrl for each store', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ elements: [{ id: 5, lat: 25.034, lon: 121.566, tags: { name: '全聯', shop: 'supermarket' } }] }),
      });

      const result = await service.nearbyStores({ query: 'vegetable', lat: USER_LAT, lng: USER_LNG });
      expect(result.stores[0].mapsUrl).toContain('google.com/maps');
      expect(result.stores[0].osmUrl).toContain('openstreetmap.org');
    });

    it('haversine: calculates ~111m per 0.001° latitude at equatorial scale', () => {
      const dist = service.haversineDistance(25.000, 121.000, 25.001, 121.000);
      expect(dist).toBeGreaterThan(100);
      expect(dist).toBeLessThan(120);
    });

    it('limits results to 15 stores maximum', async () => {
      const elements = Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        lat: USER_LAT + i * 0.001,
        lon: USER_LNG,
        tags: { name: `Store ${i + 1}`, shop: 'convenience' },
      }));
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ elements }) });

      const result = await service.nearbyStores({ query: 'milk', lat: USER_LAT, lng: USER_LNG });
      expect(result.stores.length).toBeLessThanOrEqual(15);
    });
  });

  // ─── suggestMeal ──────────────────────────────────────────────────────────

  describe('suggestMeal', () => {
    const PLAN_DATE = '2026-07-01';

    const makeAiSuggestion = (overrides: Record<string, unknown> = {}) => ({
      mealName: 'Phở bò',
      description: 'Phở truyền thống với nước dùng đậm đà.',
      category: 'MEAT',
      servings: 2,
      prepMinutes: 10,
      cookMinutes: 30,
      ingredientsJson: [{ name: 'Thịt bò', quantity: 200, unit: 'GRAM' }],
      ingredientsFromInventory: ['Thịt bò'],
      missingIngredients: ['Bánh phở'],
      stepsJson: [{ step: 1, description: 'Nấu nước dùng.' }],
      nutritionSummary: '~450 kcal, 25g đạm',
      nutritionJson: { calories: 450, protein: '25g', carbs: '40g', fat: '12g', fiber: '2g' },
      aiReason: 'Phù hợp bữa sáng.',
      estimatedCalories: 450,
      ...overrides,
    });

    beforeEach(() => {
      prisma.ingredient.findMany.mockResolvedValue([makeIngredient()] as never);
      prisma.mealPlan.findMany.mockResolvedValue([]);
      prisma.fixedEvent.findMany.mockResolvedValue([]);
      prisma.task.findMany.mockResolvedValue([]);
    });

    it('returns AI suggestion when AI responds with valid JSON', async () => {
      aiChain.generateText.mockResolvedValue(JSON.stringify(makeAiSuggestion()));

      const result = await service.suggestMeal(USER_ID, { planDate: PLAN_DATE, mealType: MealType.BREAKFAST });

      expect((result as Record<string, unknown>).mealName).toBe('Phở bò');
      expect(result.isAiGenerated).toBe(true);
      expect(result.isBusySlot).toBe(false);
    });

    it('returns ingredientsJson in the AI suggestion', async () => {
      aiChain.generateText.mockResolvedValue(JSON.stringify(makeAiSuggestion()));

      const result = await service.suggestMeal(USER_ID, { planDate: PLAN_DATE, mealType: MealType.BREAKFAST });

      expect(Array.isArray((result as Record<string, unknown>).ingredientsJson)).toBe(true);
    });

    it('falls back to deterministic suggestion when AI returns empty', async () => {
      aiChain.generateText.mockResolvedValue('');

      const result = await service.suggestMeal(USER_ID, { planDate: PLAN_DATE, mealType: MealType.BREAKFAST });

      expect((result as Record<string, unknown>).mealName).toBeDefined();
      expect(result.isAiGenerated).toBe(false);
    });

    it('marks isBusySlot true when user has more than 4 hours of scheduled events', async () => {
      prisma.fixedEvent.findMany.mockResolvedValue([
        { startTime: new Date('2026-07-01T01:00:00Z'), endTime: new Date('2026-07-01T07:00:00Z') }, // 6 hours
      ] as never);
      aiChain.generateText.mockResolvedValue(JSON.stringify(makeAiSuggestion({ mealName: 'Bánh mì' })));

      const result = await service.suggestMeal(USER_ID, { planDate: PLAN_DATE, mealType: MealType.LUNCH });

      expect(result.isBusySlot).toBe(true);
    });

    it('does not mark isBusySlot when user has little schedule', async () => {
      prisma.fixedEvent.findMany.mockResolvedValue([
        { startTime: new Date('2026-07-01T01:00:00Z'), endTime: new Date('2026-07-01T02:00:00Z') }, // 1 hour
      ] as never);
      aiChain.generateText.mockResolvedValue(JSON.stringify(makeAiSuggestion()));

      const result = await service.suggestMeal(USER_ID, { planDate: PLAN_DATE, mealType: MealType.BREAKFAST });

      expect(result.isBusySlot).toBe(false);
    });

    it('rejects AI suggestion that is in the excludeMeals list and uses deterministic fallback', async () => {
      aiChain.generateText.mockResolvedValue(JSON.stringify(makeAiSuggestion({ mealName: 'Cháo trắng với trứng' })));

      const result = await service.suggestMeal(USER_ID, {
        planDate: PLAN_DATE,
        mealType: MealType.BREAKFAST,
        excludeMeals: ['Cháo trắng với trứng'],
      });

      expect((result as Record<string, unknown>).mealName).not.toBe('Cháo trắng với trứng');
      expect(result.isAiGenerated).toBe(false);
    });

    it('includes busy-day prompt guidance when user is busy (verifies context is built)', async () => {
      prisma.fixedEvent.findMany.mockResolvedValue([
        { startTime: new Date('2026-07-01T01:00:00Z'), endTime: new Date('2026-07-01T08:00:00Z') },
      ] as never);
      aiChain.generateText.mockResolvedValue(JSON.stringify(makeAiSuggestion({ prepMinutes: 5, cookMinutes: 10 })));

      const result = await service.suggestMeal(USER_ID, { planDate: PLAN_DATE, mealType: MealType.LUNCH });

      expect(result.isBusySlot).toBe(true);
      expect((result as Record<string, unknown>).prepMinutes).toBeDefined();
    });
  });

  // ─── acceptMealSuggestion ─────────────────────────────────────────────────

  describe('acceptMealSuggestion', () => {
    it('creates a Recipe and MealPlan atomically and publishes MEAL_PLAN_CREATED', async () => {
      const mockRecipe = makeRecipe({ id: 'recipe-ai-1', title: 'Phở bò' });
      const mockPlan = {
        id: 'plan-ai-1',
        userId: USER_ID,
        planDate: new Date('2026-07-01'),
        mealType: MealType.BREAKFAST,
        recipeId: 'recipe-ai-1',
        servings: 2,
        isAiGenerated: true,
        aiReason: 'AI suggestion',
        nutritionSummary: '~450 kcal',
        notes: null,
        customMeal: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        recipe: { id: 'recipe-ai-1', title: 'Phở bò', prepMinutes: 10, cookMinutes: 30, servings: 2 },
      };

      prisma.recipe.create.mockResolvedValue(mockRecipe as never);
      prisma.mealPlan.create.mockResolvedValue(mockPlan as never);

      const result = await service.acceptMealSuggestion(USER_ID, {
        planDate: '2026-07-01',
        mealType: MealType.BREAKFAST,
        mealName: 'Phở bò',
        prepMinutes: 10,
        cookMinutes: 30,
        servings: 2,
        aiReason: 'AI suggestion',
        nutritionSummary: '~450 kcal',
        ingredientsJson: [{ name: 'Thịt bò', quantity: 200, unit: UnitOfMeasure.GRAM }],
        stepsJson: [{ step: 1, description: 'Nấu nước dùng.' }],
      });

      expect(prisma.recipe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Phở bò', isAiGenerated: true }),
        }),
      );
      expect(prisma.mealPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ recipeId: mockRecipe.id }),
        }),
      );
      expect(result.id).toBe('plan-ai-1');
      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'MEAL_PLAN_CREATED', userId: USER_ID }),
      );
    });

    it('stores recipe with the full ingredientsJson and stepsJson passed from the suggestion', async () => {
      const ingredientsJson = [{ name: 'Gà', quantity: 300, unit: UnitOfMeasure.GRAM }];
      const stepsJson = [{ step: 1, description: 'Ướp gà' }, { step: 2, description: 'Chiên vàng' }];
      const mockRecipe = makeRecipe({ id: 'recipe-ai-2', title: 'Gà chiên giòn' });
      prisma.recipe.create.mockResolvedValue(mockRecipe as never);
      prisma.mealPlan.create.mockResolvedValue({
        id: 'plan-ai-2', userId: USER_ID, planDate: new Date(), mealType: MealType.LUNCH,
        recipeId: 'recipe-ai-2', recipe: mockRecipe, servings: 1, isAiGenerated: true,
        aiReason: null, nutritionSummary: null, notes: null, customMeal: null,
        createdAt: new Date(), updatedAt: new Date(),
      } as never);

      await service.acceptMealSuggestion(USER_ID, {
        planDate: '2026-07-02',
        mealType: MealType.LUNCH,
        mealName: 'Gà chiên giòn',
        ingredientsJson,
        stepsJson,
      });

      expect(prisma.recipe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ingredientsJson, stepsJson }),
        }),
      );
    });
  });
});
