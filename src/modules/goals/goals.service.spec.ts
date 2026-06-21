import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GoalsService } from './goals.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { FinanceService } from '../finance/finance.service.js';

const dec = (v: number) => ({ toString: () => String(v) });
const baseDate = new Date(2026, 5, 21);

const mockPrisma = {
  goal: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  goalMilestone: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  goalForecast: { create: jest.fn(), findMany: jest.fn() },
};

const mockEvents = { publish: jest.fn().mockResolvedValue(undefined) };

const mockFinanceService = {
  getAverageMonthlyIncome: jest.fn(),
  getAverageMonthlyExpense: jest.fn(),
};

const makeGoal = (overrides: Partial<ReturnType<typeof baseGoal>> = {}) => ({
  ...baseGoal(),
  ...overrides,
});

function baseGoal() {
  return {
    id: 'goal-1', userId: 'u-1', goalType: 'SAVINGS', title: 'Emergency fund',
    targetAmount: dec(120000), currentAmount: dec(0),
    targetDate: new Date(2027, 5, 21),
    priority: 'MEDIUM', status: 'ACTIVE', metadataJson: null,
    createdAt: baseDate, updatedAt: baseDate,
  };
}

describe('GoalsService', () => {
  let service: GoalsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        { provide: FinanceService, useValue: mockFinanceService },
      ],
    }).compile();

    service = module.get<GoalsService>(GoalsService);
  });

  // ─── Goal CRUD ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates goal and publishes GOAL_CREATED event', async () => {
      mockPrisma.goal.create.mockResolvedValue(makeGoal());

      const result = await service.create('u-1', {
        goalType: 'SAVINGS' as const, title: 'Emergency fund',
        targetAmount: 120000, targetDate: '2027-06-21',
      });

      expect(result.title).toBe('Emergency fund');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'GOAL_CREATED' }),
      );
    });
  });

  describe('update', () => {
    it('updates goal and publishes GOAL_UPDATED event', async () => {
      const updated = makeGoal({ title: 'Updated title' });
      mockPrisma.goal.findFirst.mockResolvedValue(makeGoal());
      mockPrisma.goal.update.mockResolvedValue(updated);

      const result = await service.update('u-1', 'goal-1', { title: 'Updated title' });

      expect(result.title).toBe('Updated title');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'GOAL_UPDATED' }),
      );
    });

    it('throws NotFoundException for non-existent goal', async () => {
      mockPrisma.goal.findFirst.mockResolvedValue(null);
      await expect(service.update('u-1', 'bad-id', { title: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Milestone ────────────────────────────────────────────────────────────────

  describe('createMilestone', () => {
    it('creates milestone and publishes GOAL_MILESTONE_CREATED event', async () => {
      const milestone = {
        id: 'ms-1', goalId: 'goal-1', userId: 'u-1', title: 'First 10k',
        targetAmount: dec(10000), targetDate: null, isCompleted: false,
        completedAt: null, createdAt: baseDate, updatedAt: baseDate,
      };
      mockPrisma.goal.findFirst.mockResolvedValue(makeGoal());
      mockPrisma.goalMilestone.create.mockResolvedValue(milestone);

      await service.createMilestone('u-1', 'goal-1', {
        title: 'First 10k', targetAmount: 10000,
      });

      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'GOAL_MILESTONE_CREATED' }),
      );
    });
  });

  // ─── Forecast ─────────────────────────────────────────────────────────────────

  describe('generateForecast', () => {
    const makeForecast = (prob: number, risk: string) => ({
      id: 'fc-1', goalId: 'goal-1', userId: 'u-1',
      requiredMonthlySaving: dec(10000), currentMonthlySaving: dec(15000),
      probability: prob, riskLevel: risk, forecastDate: baseDate,
      aiReason: 'You are on track.', createdAt: baseDate,
    });

    it('generates forecast and publishes GOAL_FORECAST_GENERATED event', async () => {
      mockPrisma.goal.findFirst.mockResolvedValue(makeGoal());
      mockFinanceService.getAverageMonthlyIncome.mockResolvedValue(30000);
      mockFinanceService.getAverageMonthlyExpense.mockResolvedValue(15000);
      mockPrisma.goalForecast.create.mockResolvedValue(makeForecast(90, 'LOW'));

      await service.generateForecast('u-1', 'goal-1');

      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'GOAL_FORECAST_GENERATED' }),
      );
    });

    it('calculates LOW risk when current savings >= required', async () => {
      // targetAmount=120000, currentAmount=0, targetDate=12 months from now
      const goal = makeGoal({ targetDate: new Date(Date.now() + 12 * 30 * 24 * 60 * 60 * 1000) });
      // required ~10000/month, saving 15000/month → probability=90, riskLevel=LOW
      mockPrisma.goal.findFirst.mockResolvedValue(goal);
      mockFinanceService.getAverageMonthlyIncome.mockResolvedValue(30000);
      mockFinanceService.getAverageMonthlyExpense.mockResolvedValue(15000);

      const capturedData: Record<string, unknown> = {};
      mockPrisma.goalForecast.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(capturedData, data);
        return Promise.resolve({ ...makeForecast(data.probability as number, data.riskLevel as string), ...data });
      });

      const result = await service.generateForecast('u-1', 'goal-1');

      expect(result.probability).toBe(90);
      expect(result.riskLevel).toBe('LOW');
    });

    it('calculates HIGH risk when current savings <= 0', async () => {
      mockPrisma.goal.findFirst.mockResolvedValue(makeGoal());
      mockFinanceService.getAverageMonthlyIncome.mockResolvedValue(10000);
      mockFinanceService.getAverageMonthlyExpense.mockResolvedValue(12000);

      mockPrisma.goalForecast.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        return Promise.resolve({ ...makeForecast(data.probability as number, data.riskLevel as string), ...data });
      });

      const result = await service.generateForecast('u-1', 'goal-1');

      expect(result.probability).toBe(5);
      expect(result.riskLevel).toBe('HIGH');
    });

    it('returns limited forecast when no targetAmount or targetDate', async () => {
      const goal = { ...makeGoal(), targetAmount: undefined, targetDate: undefined };
      mockPrisma.goal.findFirst.mockResolvedValue(goal);
      mockFinanceService.getAverageMonthlyIncome.mockResolvedValue(20000);
      mockFinanceService.getAverageMonthlyExpense.mockResolvedValue(15000);

      mockPrisma.goalForecast.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        return Promise.resolve({ ...makeForecast(0, 'HIGH'), ...data });
      });

      const result = await service.generateForecast('u-1', 'goal-1');

      expect(result.probability).toBe(0);
      expect(result.riskLevel).toBe('HIGH');
    });
  });

  // ─── Recommendations ─────────────────────────────────────────────────────────

  describe('getRecommendations', () => {
    it('returns on-track message when savings exceed requirements', async () => {
      mockPrisma.goal.findFirst.mockResolvedValue(makeGoal());
      mockFinanceService.getAverageMonthlyIncome.mockResolvedValue(30000);
      mockFinanceService.getAverageMonthlyExpense.mockResolvedValue(15000);

      const result = await service.getRecommendations('u-1', 'goal-1');

      expect(result.recommendations.some((r) => r.includes('on track'))).toBe(true);
    });

    it('suggests reducing expenses when off track', async () => {
      mockPrisma.goal.findFirst.mockResolvedValue(makeGoal());
      mockFinanceService.getAverageMonthlyIncome.mockResolvedValue(12000);
      mockFinanceService.getAverageMonthlyExpense.mockResolvedValue(10000);

      const result = await service.getRecommendations('u-1', 'goal-1');

      expect(result.recommendations.some((r) => r.includes('expenses') || r.includes('income'))).toBe(true);
    });

    it('suggests recording data when no finance history', async () => {
      mockPrisma.goal.findFirst.mockResolvedValue(makeGoal());
      mockFinanceService.getAverageMonthlyIncome.mockResolvedValue(0);
      mockFinanceService.getAverageMonthlyExpense.mockResolvedValue(0);

      const result = await service.getRecommendations('u-1', 'goal-1');

      expect(result.recommendations.some((r) => r.includes('income and expenses'))).toBe(true);
    });
  });

  // ─── Ownership enforcement ────────────────────────────────────────────────────

  describe('ownership enforcement', () => {
    it('throws NotFoundException when accessing another users goal', async () => {
      mockPrisma.goal.findFirst.mockResolvedValue(null);
      await expect(service.findOne('u-1', 'other-goal')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when accessing another users milestone', async () => {
      mockPrisma.goal.findFirst.mockResolvedValue(makeGoal());
      mockPrisma.goalMilestone.findFirst.mockResolvedValue(null);
      await expect(
        service.updateMilestone('u-1', 'goal-1', 'ms-other', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
