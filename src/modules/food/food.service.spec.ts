import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FoodService } from './food.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { FoodCategory, ShoppingListStatus, UnitOfMeasure } from '@prisma/client';

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

  beforeEach(async () => {
    const mockPrisma = {
      ingredient: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      recipe: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      mealPlan: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      shoppingList: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      shoppingListItem: {
        findFirst: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      expenseCategory: { findFirst: jest.fn() },
      expense: { create: jest.fn() },
    };

    const mockEvents = { publish: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FoodService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    service = module.get<FoodService>(FoodService);
    prisma = module.get(PrismaService);
    eventsService = module.get(EventsService);
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
});
