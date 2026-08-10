import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FoodService } from './food.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { AIProviderChain, VisionUnavailableError } from '../ai/providers/ai-provider-chain.service.js';
import { UserHealthContextService } from '../profile/user-health-context.service.js';
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
  let aiChain: { generateText: jest.Mock; generateTextWithVision: jest.Mock };
  let healthContext: {
    buildAIHealthContext: jest.Mock;
    buildForbiddenAllergenList: jest.Mock;
    hasSevereAllergy: jest.Mock;
    findAllergenMatches: jest.Mock;
    checkRecipeForAllergens: jest.Mock;
  };

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
      userProfile: { findUnique: jest.fn().mockResolvedValue({ dietPreference: null }) },
    };

    const mockEvents = { publish: jest.fn().mockResolvedValue(undefined) };
    const mockAIChain = { generateText: jest.fn().mockResolvedValue(''), generateTextWithVision: jest.fn().mockResolvedValue('') };

    // Defaults to "no health data" so pre-existing (non-health) test cases
    // behave exactly as before; individual health-aware tests override these.
    const mockHealthContext = {
      buildAIHealthContext: jest.fn().mockResolvedValue({
        heightCm: null, weightKg: null, bmi: null, bmiCategory: null,
        allergies: [], healthConditions: [], medications: [], hasCompleteProfile: false,
      }),
      buildForbiddenAllergenList: jest.fn().mockReturnValue([]),
      hasSevereAllergy: jest.fn().mockReturnValue(false),
      findAllergenMatches: jest.fn().mockReturnValue([]),
      checkRecipeForAllergens: jest.fn().mockReturnValue({ safe: true, matchedAllergens: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FoodService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        { provide: AIProviderChain, useValue: mockAIChain },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
        { provide: UserHealthContextService, useValue: mockHealthContext },
      ],
    }).compile();

    service = module.get<FoodService>(FoodService);
    prisma = module.get(PrismaService);
    eventsService = module.get(EventsService);
    aiChain = module.get(AIProviderChain) as unknown as { generateText: jest.Mock; generateTextWithVision: jest.Mock };
    healthContext = module.get(UserHealthContextService);
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

    it('forwards AI-scan metadata (freshnessStatus, estimatedDaysRemaining) to the created record', async () => {
      const item = makeIngredient();
      prisma.ingredient.create.mockResolvedValue(item as never);

      await service.createIngredient(USER_ID, {
        name: 'Sữa tươi',
        sourceType: 'camera_scan',
        freshnessStatus: 'near_expiry',
        estimatedDaysRemaining: 2,
      });

      expect(prisma.ingredient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ freshnessStatus: 'near_expiry', estimatedDaysRemaining: 2 }),
        }),
      );
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

  describe('generateRecipes', () => {
    it('sends existing ingredients to the AI and marks results as based on inventory', async () => {
      const ingredients = [makeIngredient({ name: 'Bánh Mì', category: FoodCategory.OTHER, quantity: { toString: () => '1' } })];
      prisma.ingredient.findMany.mockResolvedValue(ingredients as never);
      aiChain.generateText.mockResolvedValue(JSON.stringify([
        { title: 'Bánh mì chiên trứng', category: 'OTHER', ingredientsJson: [{ name: 'Bánh Mì', quantity: 1, unit: 'PIECE' }], missingIngredients: ['Trứng'] },
      ]));

      const result = await service.generateRecipes(USER_ID, {});

      expect(result).toHaveLength(1);
      expect(result[0].basedOnInventory).toBe(true);
      expect(result[0].isAiGenerated).toBe(true);
      expect(result[0].matchRate).toBe(100);
      expect(aiChain.generateText).toHaveBeenCalledWith(expect.stringContaining('Bánh Mì'));
    });

    it('does not return an empty list when the user has ingredients but the AI is unavailable, regardless of ingredient category', async () => {
      // Regression test: previously the deterministic fallback only produced a suggestion for
      // VEGETABLE/MEAT/SEAFOOD categories, so an OTHER-category ingredient (e.g. "Bánh Mì") silently
      // produced zero recipes even though the user clearly had ingredients.
      const ingredients = [makeIngredient({ name: 'Bánh Mì', category: FoodCategory.OTHER, quantity: { toString: () => '1' } })];
      prisma.ingredient.findMany.mockResolvedValue(ingredients as never);
      aiChain.generateText.mockResolvedValue('');

      const result = await service.generateRecipes(USER_ID, {});

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].isAiGenerated).toBe(false);
      expect(result[0].basedOnInventory).toBe(true);
      expect(JSON.stringify((result[0] as Record<string, unknown>).ingredientsJson)).toContain('Bánh Mì');
    });

    it('generates generic popular recipes (not blocked) when the user has no ingredients and the AI responds', async () => {
      prisma.ingredient.findMany.mockResolvedValue([]);
      aiChain.generateText.mockResolvedValue(JSON.stringify([
        { title: 'Cơm chiên trứng', category: 'GRAIN', ingredientsJson: [], missingIngredients: [] },
      ]));

      const result = await service.generateRecipes(USER_ID, {});

      expect(result).toHaveLength(1);
      expect(result[0].basedOnInventory).toBe(false);
      expect(result[0].matchRate).toBeUndefined();
      expect(aiChain.generateText).toHaveBeenCalledWith(expect.stringContaining('no ingredients logged'));
    });

    it('falls back to generic recipes (not empty) when the user has no ingredients and the AI is unavailable', async () => {
      prisma.ingredient.findMany.mockResolvedValue([]);
      aiChain.generateText.mockResolvedValue('');

      const result = await service.generateRecipes(USER_ID, { count: 2 });

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.basedOnInventory === false && r.isAiGenerated === false)).toBe(true);
    });
  });

  describe('generateRecipes — health-aware allergen safety', () => {
    it('loads the authenticated user\'s health context and includes forbidden allergens in the prompt', async () => {
      prisma.ingredient.findMany.mockResolvedValue([]);
      healthContext.buildAIHealthContext.mockResolvedValue({
        heightCm: 170, weightKg: 90, bmi: 31.1, bmiCategory: 'Béo phì độ II',
        allergies: [{ name: 'Đậu phộng', severity: 'severe' }], healthConditions: [], medications: [], hasCompleteProfile: true,
      });
      healthContext.buildForbiddenAllergenList.mockReturnValue(['đậu phộng', 'peanut', 'peanuts']);
      aiChain.generateText.mockResolvedValue(JSON.stringify([{ title: 'Cơm chiên trứng', category: 'GRAIN', ingredientsJson: [] }]));

      await service.generateRecipes(USER_ID, {});

      expect(healthContext.buildAIHealthContext).toHaveBeenCalledWith(USER_ID);
      expect(aiChain.generateText).toHaveBeenCalledWith(expect.stringContaining('đậu phộng'));
    });

    it('rejects a generated recipe containing an allergen and retries once with a correction notice', async () => {
      prisma.ingredient.findMany.mockResolvedValue([]);
      healthContext.buildForbiddenAllergenList.mockReturnValue(['tôm']);
      healthContext.checkRecipeForAllergens
        .mockReturnValueOnce({ safe: false, matchedAllergens: ['tôm'] }) // 1st attempt: unsafe
        .mockReturnValueOnce({ safe: true, matchedAllergens: [] }); // 2nd attempt (retry): safe

      aiChain.generateText
        .mockResolvedValueOnce(JSON.stringify([{ title: 'Tôm rang muối', category: 'SEAFOOD', ingredientsJson: [] }]))
        .mockResolvedValueOnce(JSON.stringify([{ title: 'Gà xào sả', category: 'MEAT', ingredientsJson: [] }]));

      const result = await service.generateRecipes(USER_ID, {});

      expect(aiChain.generateText).toHaveBeenCalledTimes(2);
      // The retry prompt must call out what went wrong.
      expect(aiChain.generateText.mock.calls[1][0]).toContain('tôm');
      expect(result).toHaveLength(1);
      expect((result[0] as Record<string, unknown>).title).toBe('Gà xào sả');
    });

    it('fails safely (drops unsafe recipes rather than returning them) after exhausting retries', async () => {
      prisma.ingredient.findMany.mockResolvedValue([]);
      healthContext.buildForbiddenAllergenList.mockReturnValue(['tôm']);
      healthContext.checkRecipeForAllergens.mockReturnValue({ safe: false, matchedAllergens: ['tôm'] }); // always unsafe

      aiChain.generateText.mockResolvedValue(JSON.stringify([{ title: 'Tôm rang muối', category: 'SEAFOOD', ingredientsJson: [] }]));

      const result = await service.generateRecipes(USER_ID, {});

      // Every AI-suggested recipe was unsafe on every attempt, so none should
      // be returned — the response is never silently unsafe.
      expect(result.every((r) => (r as Record<string, unknown>).title !== 'Tôm rang muối')).toBe(true);
      expect(aiChain.generateText).toHaveBeenCalledTimes(2); // capped at MAX_ATTEMPTS
    });

    it('still generates recipes when the health profile is empty/incomplete', async () => {
      prisma.ingredient.findMany.mockResolvedValue([]);
      // healthContext defaults (from beforeEach) already represent an empty profile.
      aiChain.generateText.mockResolvedValue(JSON.stringify([{ title: 'Cơm chiên trứng', category: 'GRAIN', ingredientsJson: [] }]));

      const result = await service.generateRecipes(USER_ID, {});

      expect(result).toHaveLength(1);
    });

    it('adds a severe-allergy warning to every recipe when the user has a severe allergy', async () => {
      prisma.ingredient.findMany.mockResolvedValue([]);
      healthContext.hasSevereAllergy.mockReturnValue(true);
      aiChain.generateText.mockResolvedValue(JSON.stringify([{ title: 'Cơm chiên trứng', category: 'GRAIN', ingredientsJson: [] }]));

      const result = await service.generateRecipes(USER_ID, {});

      const warnings = (result[0] as Record<string, unknown>).healthSuitability as { warnings: string[] };
      expect(warnings.warnings.some((w) => w.includes('NẶNG'))).toBe(true);
    });

    it('always includes the general AI-recipe safety disclaimer, even without a severe allergy', async () => {
      prisma.ingredient.findMany.mockResolvedValue([]);
      aiChain.generateText.mockResolvedValue(JSON.stringify([{ title: 'Cơm chiên trứng', category: 'GRAIN', ingredientsJson: [] }]));

      const result = await service.generateRecipes(USER_ID, {});

      const warnings = (result[0] as Record<string, unknown>).healthSuitability as { warnings: string[] };
      expect(warnings.warnings.length).toBeGreaterThan(0);
    });

    it('regression: excludes a pantry ingredient matching a known allergen from the deterministic fallback (AI unavailable)', async () => {
      // This is the critical bug caught during manual testing: the deterministic
      // fallback used to build a dish name directly from pantry item names,
      // completely bypassing allergen safety when the AI is rate-limited/down.
      const ingredients = [
        makeIngredient({ name: 'Đậu phộng rang', category: FoodCategory.SNACK }),
        makeIngredient({ id: 'ing-2', name: 'Gà', category: FoodCategory.MEAT }),
      ];
      prisma.ingredient.findMany.mockResolvedValue(ingredients as never);
      healthContext.buildForbiddenAllergenList.mockReturnValue(['đậu phộng']);
      healthContext.findAllergenMatches.mockImplementation((text: string, terms: string[]) =>
        terms.filter((t) => text.toLowerCase().includes(t)),
      );
      aiChain.generateText.mockResolvedValue(''); // AI unavailable -> deterministic fallback

      const result = await service.generateRecipes(USER_ID, { count: 1 });

      const allText = JSON.stringify(result);
      expect(allText).not.toContain('Đậu phộng');
      expect(allText).toContain('Gà');
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

    it('rejects an AI meal suggestion containing an allergen and retries with a correction notice', async () => {
      healthContext.buildForbiddenAllergenList.mockReturnValue(['tôm']);
      healthContext.checkRecipeForAllergens
        .mockReturnValueOnce({ safe: false, matchedAllergens: ['tôm'] })
        .mockReturnValueOnce({ safe: true, matchedAllergens: [] });

      aiChain.generateText
        .mockResolvedValueOnce(JSON.stringify(makeAiSuggestion({ mealName: 'Tôm rang muối' })))
        .mockResolvedValueOnce(JSON.stringify(makeAiSuggestion({ mealName: 'Gà xào sả' })));

      const result = await service.suggestMeal(USER_ID, { planDate: PLAN_DATE, mealType: MealType.DINNER });

      expect(aiChain.generateText).toHaveBeenCalledTimes(2);
      expect((result as Record<string, unknown>).mealName).toBe('Gà xào sả');
    });

    it('fails safely to the deterministic fallback after exhausting retries on an unsafe suggestion', async () => {
      healthContext.buildForbiddenAllergenList.mockReturnValue(['tôm']);
      healthContext.checkRecipeForAllergens.mockReturnValue({ safe: false, matchedAllergens: ['tôm'] });
      aiChain.generateText.mockResolvedValue(JSON.stringify(makeAiSuggestion({ mealName: 'Tôm rang muối' })));

      const result = await service.suggestMeal(USER_ID, { planDate: PLAN_DATE, mealType: MealType.DINNER });

      expect((result as Record<string, unknown>).mealName).not.toBe('Tôm rang muối');
      expect(result.isAiGenerated).toBe(false);
    });

    it('regression: the deterministic fallback pool itself is filtered by allergen (e.g. "Tôm rang muối" in DINNER pool)', async () => {
      healthContext.buildForbiddenAllergenList.mockReturnValue(['tôm']);
      healthContext.findAllergenMatches.mockImplementation((text: string, terms: string[]) =>
        terms.filter((t) => text.toLowerCase().includes(t)),
      );
      aiChain.generateText.mockResolvedValue(''); // AI unavailable -> deterministic fallback

      const result = await service.suggestMeal(USER_ID, { planDate: PLAN_DATE, mealType: MealType.DINNER });

      expect((result as Record<string, unknown>).mealName).not.toBe('Tôm rang muối');
    });

    it('adds a severe-allergy warning to the deterministic fallback suggestion too, not just the AI path', async () => {
      healthContext.hasSevereAllergy.mockReturnValue(true);
      aiChain.generateText.mockResolvedValue(''); // deterministic fallback

      const result = await service.suggestMeal(USER_ID, { planDate: PLAN_DATE, mealType: MealType.BREAKFAST });

      const suitability = (result as Record<string, unknown>).healthSuitability as { warnings: string[] };
      expect(suitability.warnings.some((w) => w.includes('NẶNG'))).toBe(true);
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

    it('rejects and does not persist a client-submitted meal that matches a declared allergen (defense in depth)', async () => {
      healthContext.buildForbiddenAllergenList.mockReturnValue(['tôm']);
      healthContext.checkRecipeForAllergens.mockReturnValue({ safe: false, matchedAllergens: ['tôm'] });

      await expect(
        service.acceptMealSuggestion(USER_ID, {
          planDate: '2026-07-01',
          mealType: MealType.DINNER,
          mealName: 'Tôm rang muối',
          ingredientsJson: [{ name: 'Tôm', quantity: 200, unit: UnitOfMeasure.GRAM }],
          stepsJson: [{ step: 1, description: 'Rang tôm.' }],
        }),
      ).rejects.toThrow();

      expect(prisma.recipe.create).not.toHaveBeenCalled();
      expect(prisma.mealPlan.create).not.toHaveBeenCalled();
    });
  });

  // ─── findExistingUserRecipe (duplicate detection) ────────────────────────────

  describe('findExistingUserRecipe', () => {
    it('matches on exact normalized name regardless of accents/case/punctuation', async () => {
      prisma.recipe.findMany.mockResolvedValue([makeRecipe({ id: 'r-1', title: 'Canh Cà Rốt!' })] as never);

      const found = await service.findExistingUserRecipe(USER_ID, { name: 'canh ca rot' });

      expect(found?.id).toBe('r-1');
    });

    it('matches near-duplicate names via token similarity', async () => {
      prisma.recipe.findMany.mockResolvedValue([makeRecipe({ id: 'r-2', title: 'Canh cà rốt thịt bằm' })] as never);

      const found = await service.findExistingUserRecipe(USER_ID, { name: 'Canh cà rốt' });

      expect(found?.id).toBe('r-2');
    });

    it('matches on high ingredient overlap with a loosely similar name', async () => {
      prisma.recipe.findMany.mockResolvedValue([
        makeRecipe({
          id: 'r-3',
          title: 'Trứng chiên hành',
          ingredientsJson: [{ name: 'Trứng', quantity: 3, unit: 'PIECE' }, { name: 'Hành lá', quantity: 1, unit: 'PIECE' }],
        }),
      ] as never);

      const found = await service.findExistingUserRecipe(USER_ID, {
        name: 'Trứng chiên',
        ingredients: [{ name: 'Trứng' }, { name: 'Hành lá' }],
      });

      expect(found?.id).toBe('r-3');
    });

    it('returns null when no recipe is similar enough', async () => {
      prisma.recipe.findMany.mockResolvedValue([makeRecipe({ id: 'r-4', title: 'Bún bò Huế' })] as never);

      const found = await service.findExistingUserRecipe(USER_ID, { name: 'Cơm chiên trứng' });

      expect(found).toBeNull();
    });

    it('only queries recipes scoped to the given userId', async () => {
      prisma.recipe.findMany.mockResolvedValue([]);

      await service.findExistingUserRecipe(USER_ID, { name: 'Phở bò' });

      expect(prisma.recipe.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: USER_ID } }));
    });
  });

  // ─── validateRecipesForMealPlan ───────────────────────────────────────────────

  describe('validateRecipesForMealPlan', () => {
    it('throws NotFoundException when a recipe id does not belong to the user', async () => {
      prisma.recipe.findMany.mockResolvedValue([]);

      await expect(
        service.validateRecipesForMealPlan(USER_ID, { date: '2026-07-07', mealType: MealType.BREAKFAST, recipeIds: ['missing-1'] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('is suitable with no AI call when calories are within the meal-type range', async () => {
      prisma.recipe.findMany.mockResolvedValue([makeRecipe({ id: 'r-1', nutritionJson: { calories: 400 } })] as never);
      prisma.mealPlan.findMany.mockResolvedValue([]);

      const result = await service.validateRecipesForMealPlan(USER_ID, {
        date: '2026-07-07',
        mealType: MealType.BREAKFAST,
        recipeIds: ['r-1'],
      });

      expect(result.isSuitable).toBe(true);
      expect(result.warnings).toHaveLength(0);
      expect(result.aiAdvice).toBe('');
      expect(aiChain.generateText).not.toHaveBeenCalled();
    });

    it('flags too-high calories for the meal type and calls AI for advice', async () => {
      prisma.recipe.findMany.mockResolvedValueOnce([makeRecipe({ id: 'r-1', title: 'Lẩu thập cẩm', nutritionJson: { calories: 1200 } })] as never);
      prisma.mealPlan.findMany.mockResolvedValue([]);
      aiChain.generateText.mockResolvedValue('Bạn nên ăn ít lại hoặc chọn món nhẹ hơn.');

      const result = await service.validateRecipesForMealPlan(USER_ID, {
        date: '2026-07-07',
        mealType: MealType.SNACK,
        recipeIds: ['r-1'],
      });

      expect(result.isSuitable).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.aiAdvice).toBe('Bạn nên ăn ít lại hoặc chọn món nhẹ hơn.');
      expect(aiChain.generateText).toHaveBeenCalled();
    });

    it('falls back to a deterministic advice message when AI is unavailable', async () => {
      prisma.recipe.findMany.mockResolvedValueOnce([makeRecipe({ id: 'r-1', nutritionJson: { calories: 1200 } })] as never);
      prisma.mealPlan.findMany.mockResolvedValue([]);
      aiChain.generateText.mockResolvedValue('');

      const result = await service.validateRecipesForMealPlan(USER_ID, {
        date: '2026-07-07',
        mealType: MealType.SNACK,
        recipeIds: ['r-1'],
      });

      expect(result.isSuitable).toBe(false);
      expect(result.aiAdvice.length).toBeGreaterThan(0);
    });

    it('flags incomplete nutrition data as a warning', async () => {
      prisma.recipe.findMany.mockResolvedValueOnce([makeRecipe({ id: 'r-1', nutritionJson: null })] as never);
      prisma.mealPlan.findMany.mockResolvedValue([]);
      aiChain.generateText.mockResolvedValue('advice');

      const result = await service.validateRecipesForMealPlan(USER_ID, {
        date: '2026-07-07',
        mealType: MealType.LUNCH,
        recipeIds: ['r-1'],
      });

      expect(result.isSuitable).toBe(false);
      expect(result.warnings.some((w) => w.toLowerCase().includes('incomplete'))).toBe(true);
    });

    it('only validates recipes owned by the current user', async () => {
      prisma.recipe.findMany.mockResolvedValue([]);

      await expect(
        service.validateRecipesForMealPlan(USER_ID, { date: '2026-07-07', mealType: MealType.LUNCH, recipeIds: ['other-users-recipe'] }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.recipe.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID }) }),
      );
    });
  });

  // ─── addRecipesToMealPlan ──────────────────────────────────────────────────────

  describe('addRecipesToMealPlan', () => {
    it('creates meal plan entries referencing existing recipe ids without creating new recipes', async () => {
      prisma.recipe.findMany.mockResolvedValue([makeRecipe({ id: 'r-1' }), makeRecipe({ id: 'r-2', title: 'Trứng chiên' })] as never);
      prisma.mealPlan.findMany.mockResolvedValue([]);
      prisma.mealPlan.create
        .mockResolvedValueOnce({ id: 'mp-1', recipeId: 'r-1' } as never)
        .mockResolvedValueOnce({ id: 'mp-2', recipeId: 'r-2' } as never);

      const result = await service.addRecipesToMealPlan(USER_ID, {
        date: '2026-07-07',
        mealType: MealType.BREAKFAST,
        recipeIds: ['r-1', 'r-2'],
      });

      expect(prisma.recipe.create).not.toHaveBeenCalled();
      expect(prisma.mealPlan.create).toHaveBeenCalledTimes(2);
      expect(result.created).toHaveLength(2);
      expect(result.skippedDuplicates).toHaveLength(0);
    });

    it('skips recipes already present in the same date + mealType slot', async () => {
      prisma.recipe.findMany.mockResolvedValue([makeRecipe({ id: 'r-1', title: 'Canh cà rốt' })] as never);
      prisma.mealPlan.findMany.mockResolvedValue([{ id: 'existing-mp', recipeId: 'r-1' }] as never);

      const result = await service.addRecipesToMealPlan(USER_ID, {
        date: '2026-07-07',
        mealType: MealType.BREAKFAST,
        recipeIds: ['r-1'],
      });

      expect(prisma.mealPlan.create).not.toHaveBeenCalled();
      expect(result.created).toHaveLength(0);
      expect(result.skippedDuplicates).toEqual(['Canh cà rốt']);
    });

    it('throws NotFoundException when a recipe does not belong to the user', async () => {
      prisma.recipe.findMany.mockResolvedValue([]);

      await expect(
        service.addRecipesToMealPlan(USER_ID, { date: '2026-07-07', mealType: MealType.LUNCH, recipeIds: ['not-mine'] }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── saveAiSuggestion ──────────────────────────────────────────────────────────

  describe('saveAiSuggestion', () => {
    it('creates a new recipe when no duplicate exists, then links it to the meal slot', async () => {
      prisma.recipe.findMany.mockResolvedValue([]); // no existing recipes → no duplicate
      const createdRecipe = makeRecipe({ id: 'new-recipe-1', title: 'Cháo gà' });
      prisma.recipe.create.mockResolvedValue(createdRecipe as never);
      prisma.mealPlan.findFirst.mockResolvedValue(null);
      prisma.mealPlan.create.mockResolvedValue({ id: 'mp-new-1', recipeId: 'new-recipe-1' } as never);

      const result = await service.saveAiSuggestion(USER_ID, {
        date: '2026-07-07',
        mealType: MealType.DINNER,
        suggestion: { name: 'Cháo gà', calories: 300, ingredients: [{ name: 'Gà', quantity: 200, unit: 'GRAM' }] },
      });

      expect(prisma.recipe.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ title: 'Cháo gà', isAiGenerated: true }) }),
      );
      expect(prisma.mealPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ recipeId: 'new-recipe-1' }) }),
      );
      expect(result.reusedExistingRecipe).toBe(false);
    });

    it('reuses an existing recipe instead of creating a duplicate when one already matches', async () => {
      const existingRecipe = makeRecipe({ id: 'existing-recipe-1', title: 'Cháo gà' });
      prisma.recipe.findMany.mockResolvedValue([existingRecipe] as never);
      prisma.mealPlan.findFirst.mockResolvedValue(null);
      prisma.mealPlan.create.mockResolvedValue({ id: 'mp-new-2', recipeId: 'existing-recipe-1' } as never);

      const result = await service.saveAiSuggestion(USER_ID, {
        date: '2026-07-07',
        mealType: MealType.DINNER,
        suggestion: { name: 'Cháo gà', calories: 300 },
      });

      expect(prisma.recipe.create).not.toHaveBeenCalled();
      expect(prisma.mealPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ recipeId: 'existing-recipe-1' }) }),
      );
      expect(result.reusedExistingRecipe).toBe(true);
    });

    it('does not create a duplicate meal item when the slot already has this recipe', async () => {
      const existingRecipe = makeRecipe({ id: 'existing-recipe-2', title: 'Cháo gà' });
      prisma.recipe.findMany.mockResolvedValue([existingRecipe] as never);
      const existingPlan = { id: 'mp-existing', recipeId: 'existing-recipe-2' };
      prisma.mealPlan.findFirst.mockResolvedValue(existingPlan as never);

      const result = await service.saveAiSuggestion(USER_ID, {
        date: '2026-07-07',
        mealType: MealType.DINNER,
        suggestion: { name: 'Cháo gà' },
      });

      expect(prisma.mealPlan.create).not.toHaveBeenCalled();
      expect(result.mealPlan).toBe(existingPlan);
    });
  });

  // ─── scanIngredient ────────────────────────────────────────────────────────

  describe('scanIngredient', () => {
    it('coerces a lowercase/synonym unit and category from the AI into valid enum members', async () => {
      aiChain.generateTextWithVision.mockResolvedValue(
        JSON.stringify({
          isFood: true,
          name: 'Carrot',
          nameVi: 'Cà rốt',
          category: 'vegetable',
          quantity: 2,
          unit: 'piece', // lowercase — would fail CreateIngredientDto's @IsEnum(UnitOfMeasure) as-is
        }),
      );

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.unit).toBe(UnitOfMeasure.PIECE);
      expect(result.category).toBe(FoodCategory.VEGETABLE);
    });

    it('falls back to PIECE/OTHER when the AI returns a unit or category outside the enum', async () => {
      aiChain.generateTextWithVision.mockResolvedValue(
        JSON.stringify({
          isFood: true,
          name: 'Mystery item',
          category: 'not-a-real-category',
          unit: 'quả', // hallucinated Vietnamese unit, not in UnitOfMeasure
        }),
      );

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.unit).toBe(UnitOfMeasure.PIECE);
      expect(result.category).toBe(FoodCategory.OTHER);
    });

    it('passes through an already-valid unit and category unchanged', async () => {
      aiChain.generateTextWithVision.mockResolvedValue(
        JSON.stringify({ isFood: true, name: 'Milk', category: 'DAIRY', unit: 'LITER' }),
      );

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.unit).toBe(UnitOfMeasure.LITER);
      expect(result.category).toBe(FoodCategory.DAIRY);
    });

    it('detects a real ingredient from a well-formed AI response (e.g. apple)', async () => {
      aiChain.generateTextWithVision.mockResolvedValue(
        JSON.stringify({
          isFood: true,
          name: 'Apple',
          nameVi: 'Táo',
          category: 'FRUIT',
          quantity: 3,
          unit: 'PIECE',
          aiConfidence: 95,
          reason: 'Three red apples on a wooden table.',
        }),
      );

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.isFood).toBe(true);
      expect(result.nameVi).toBe('Táo');
      expect(result.aiConfidence).toBe(95);
      expect(result.fallback).toBeUndefined();
      expect((result as { aiError?: boolean }).aiError).toBeUndefined();
    });

    it('handles a ```json-fenced AI response (Gemini does not always honor "no markdown")', async () => {
      aiChain.generateTextWithVision.mockResolvedValue(
        '```json\n' + JSON.stringify({ isFood: true, name: 'Banana', category: 'FRUIT' }) + '\n```',
      );

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.isFood).toBe(true);
      expect(result.name).toBe('Banana');
    });

    it('returns a genuine, unflagged NO_FOOD result when the AI explicitly says isFood: false', async () => {
      aiChain.generateTextWithVision.mockResolvedValue(
        JSON.stringify({ isFood: false, reason: 'The image shows a laptop, not food.' }),
      );

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.isFood).toBe(false);
      expect(result.fallback).toBeUndefined();
      expect((result as { aiError?: boolean }).aiError).toBeUndefined();
    });

    it('normalizes a 0-1 scale confidence to 0-100 (provider scale drift)', async () => {
      aiChain.generateTextWithVision.mockResolvedValue(
        JSON.stringify({ isFood: true, name: 'Egg', aiConfidence: 0.95 }),
      );

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.aiConfidence).toBe(95);
    });

    it('passes through an already 0-100 scale confidence unchanged', async () => {
      aiChain.generateTextWithVision.mockResolvedValue(
        JSON.stringify({ isFood: true, name: 'Egg', aiConfidence: 95 }),
      );

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.aiConfidence).toBe(95);
    });

    it('marks the result fallback:true (AI unavailable) when no vision provider is configured at all', async () => {
      aiChain.generateTextWithVision.mockResolvedValue('');

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.isFood).toBe(false);
      expect(result.fallback).toBe(true);
      expect((result as { aiError?: boolean }).aiError).toBeUndefined();
    });

    it('marks the result aiError:true (NOT no-food) when the vision request itself fails (quota/network/etc)', async () => {
      aiChain.generateTextWithVision.mockRejectedValue(new VisionUnavailableError('429 quota exceeded'));

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.isFood).toBe(false);
      expect(result.aiError).toBe(true);
      expect(result.fallback).toBeUndefined();
    });

    it('marks the result aiError:true (NOT no-food) when the AI responds with unparseable text', async () => {
      // e.g. the deterministic provider's random non-JSON wellness tip, if it
      // were ever reached for this endpoint, or a genuinely malformed AI reply.
      aiChain.generateTextWithVision.mockResolvedValue('Hãy uống đủ nước mỗi ngày.');

      const result = await service.scanIngredient(USER_ID, { imageBase64: 'abc123' });

      expect(result.isFood).toBe(false);
      expect(result.aiError).toBe(true);
      expect(result.fallback).toBeUndefined();
    });

    it('re-throws an unexpected (non-vision) error from the AI chain instead of swallowing it', async () => {
      aiChain.generateTextWithVision.mockRejectedValue(new Error('unexpected boom'));

      await expect(service.scanIngredient(USER_ID, { imageBase64: 'abc123' })).rejects.toThrow('unexpected boom');
    });
  });

  // ─── lookupBarcode ─────────────────────────────────────────────────────────

  describe('lookupBarcode', () => {
    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it('returns found:false without calling the network for a non-numeric barcode', async () => {
      const result = await service.lookupBarcode('not-a-barcode!!');

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.found).toBe(false);
    });

    it('maps a found product to name/category/unit', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 1,
          product: {
            product_name: 'Fresh Milk',
            categories_tags: ['en:dairies', 'en:milks'],
            quantity: '1 L',
            brands: 'Kuang Chuan',
            image_front_url: 'https://example.com/milk.jpg',
          },
        }),
      });

      const result = await service.lookupBarcode('4710011401352');

      expect(result.found).toBe(true);
      expect(result.name).toBe('Fresh Milk');
      expect(result.category).toBe(FoodCategory.DAIRY);
      expect(result.unit).toBe(UnitOfMeasure.LITER);
      expect(result.brand).toBe('Kuang Chuan');
      expect(result.imageUrl).toBe('https://example.com/milk.jpg');
    });

    it('strips non-digit characters (e.g. dashes) before querying', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 1, product: { product_name: 'Item' } }),
      });

      await service.lookupBarcode('471-0011-401352');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('4710011401352'),
        expect.anything(),
      );
    });

    it('returns found:false when Open Food Facts has no match (status 0)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 0 }),
      });

      const result = await service.lookupBarcode('0000000000000');

      expect(result.found).toBe(false);
      expect(result.reason).toContain('Không tìm thấy');
    });

    it('returns found:false when the network request fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network unreachable'));

      const result = await service.lookupBarcode('4710011401352');

      expect(result.found).toBe(false);
      expect(result.reason).toContain('Không thể tra cứu');
    });

    it('defaults to OTHER/PIECE when the product has no recognizable category or quantity', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 1, product: { product_name: 'Mystery Snack' } }),
      });

      const result = await service.lookupBarcode('1234567890123');

      expect(result.category).toBe(FoodCategory.OTHER);
      expect(result.unit).toBe(UnitOfMeasure.PIECE);
    });
  });
});
