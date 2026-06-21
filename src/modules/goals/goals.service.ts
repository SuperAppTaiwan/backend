import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { FinanceService } from '../finance/finance.service.js';
import { CreateGoalDto } from './dto/create-goal.dto.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';
import { CreateMilestoneDto, UpdateMilestoneDto } from './dto/create-milestone.dto.js';

type DecimalLike = { toString(): string } | null;

function toStr(v: DecimalLike): string | null {
  return v?.toString() ?? null;
}

function toNum(v: DecimalLike): number {
  return v ? parseFloat(v.toString()) : 0;
}

function monthsBetween(from: Date, to: Date): number {
  return Math.max(
    1,
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()),
  );
}

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly financeService: FinanceService,
  ) {}

  // ─── Goals ───────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateGoalDto) {
    const goal = await this.prisma.goal.create({
      data: {
        userId,
        goalType: dto.goalType,
        title: dto.title,
        targetAmount: dto.targetAmount,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        priority: dto.priority ?? 'MEDIUM',
        metadataJson: dto.metadataJson as Prisma.InputJsonValue,
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.GOAL_CREATED,
      sourceModule: 'goals',
      payload: { goalId: goal.id, goalType: goal.goalType, title: goal.title },
    });

    return this.mapGoal(goal);
  }

  async findAll(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });
    return goals.map(this.mapGoal);
  }

  async findOne(userId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) throw new NotFoundException('Goal not found');
    return this.mapGoal(goal);
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    await this.findOne(userId, id);
    const updated = await this.prisma.goal.update({
      where: { id },
      data: {
        ...(dto.goalType !== undefined && { goalType: dto.goalType }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.targetAmount !== undefined && { targetAmount: dto.targetAmount }),
        ...(dto.currentAmount !== undefined && { currentAmount: dto.currentAmount }),
        ...(dto.targetDate !== undefined && { targetDate: new Date(dto.targetDate) }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.metadataJson !== undefined && {
          metadataJson: dto.metadataJson as Prisma.InputJsonValue,
        }),
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.GOAL_UPDATED,
      sourceModule: 'goals',
      payload: { goalId: id },
    });

    return this.mapGoal(updated);
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.goal.delete({ where: { id } });

    await this.events.publish({
      userId,
      eventType: EventType.GOAL_DELETED,
      sourceModule: 'goals',
      payload: { goalId: id },
    });

    return { success: true };
  }

  // ─── Milestones ──────────────────────────────────────────────────────────────

  async createMilestone(userId: string, goalId: string, dto: CreateMilestoneDto) {
    await this.findOne(userId, goalId);

    const milestone = await this.prisma.goalMilestone.create({
      data: {
        goalId,
        userId,
        title: dto.title,
        targetAmount: dto.targetAmount,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.GOAL_MILESTONE_CREATED,
      sourceModule: 'goals',
      payload: { milestoneId: milestone.id, goalId },
    });

    return this.mapMilestone(milestone);
  }

  async findMilestones(userId: string, goalId: string) {
    await this.findOne(userId, goalId);
    const milestones = await this.prisma.goalMilestone.findMany({
      where: { goalId, userId },
      orderBy: { createdAt: 'asc' },
    });
    return milestones.map(this.mapMilestone);
  }

  async updateMilestone(
    userId: string,
    goalId: string,
    milestoneId: string,
    dto: UpdateMilestoneDto,
  ) {
    await this.findOne(userId, goalId);
    const milestone = await this.prisma.goalMilestone.findFirst({
      where: { id: milestoneId, goalId, userId },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');

    const updated = await this.prisma.goalMilestone.update({
      where: { id: milestoneId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.targetAmount !== undefined && { targetAmount: dto.targetAmount }),
        ...(dto.targetDate !== undefined && { targetDate: new Date(dto.targetDate) }),
        ...(dto.isCompleted !== undefined && {
          isCompleted: dto.isCompleted,
          completedAt: dto.isCompleted ? new Date() : null,
        }),
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.GOAL_MILESTONE_UPDATED,
      sourceModule: 'goals',
      payload: { milestoneId, goalId },
    });

    return this.mapMilestone(updated);
  }

  async removeMilestone(userId: string, goalId: string, milestoneId: string) {
    await this.findOne(userId, goalId);
    const milestone = await this.prisma.goalMilestone.findFirst({
      where: { id: milestoneId, goalId, userId },
    });
    if (!milestone) throw new NotFoundException('Milestone not found');

    await this.prisma.goalMilestone.delete({ where: { id: milestoneId } });

    await this.events.publish({
      userId,
      eventType: EventType.GOAL_MILESTONE_DELETED,
      sourceModule: 'goals',
      payload: { milestoneId, goalId },
    });

    return { success: true };
  }

  // ─── Forecast ─────────────────────────────────────────────────────────────────

  async generateForecast(userId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({ where: { id: goalId, userId } });
    if (!goal) throw new NotFoundException('Goal not found');

    const [avgIncome, avgExpense] = await Promise.all([
      this.financeService.getAverageMonthlyIncome(userId),
      this.financeService.getAverageMonthlyExpense(userId),
    ]);

    const targetAmount = goal.targetAmount ? toNum(goal.targetAmount) : null;
    const currentAmount = toNum(goal.currentAmount);
    const now = new Date();

    let requiredMonthlySaving: number | null = null;
    let probability: number;
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    let aiReason: string;

    const currentMonthlySaving = avgIncome - avgExpense;

    if (!targetAmount || !goal.targetDate) {
      probability = 0;
      riskLevel = 'HIGH';
      aiReason =
        'Goal has no target amount or target date. Set both to get an accurate forecast.';
    } else {
      const remainingAmount = Math.max(0, targetAmount - currentAmount);
      const months = monthsBetween(now, goal.targetDate);
      requiredMonthlySaving = remainingAmount / months;

      if (currentMonthlySaving <= 0) {
        probability = 5;
      } else if (currentMonthlySaving >= requiredMonthlySaving) {
        probability = 90;
      } else {
        probability = Math.round((currentMonthlySaving / requiredMonthlySaving) * 85 + 5);
        probability = Math.min(90, Math.max(5, probability));
      }

      riskLevel = probability >= 75 ? 'LOW' : probability >= 40 ? 'MEDIUM' : 'HIGH';

      const shortfall = requiredMonthlySaving - currentMonthlySaving;
      if (probability >= 75) {
        aiReason = `You are on track. Current monthly savings (${Math.round(currentMonthlySaving)} TWD) meet the required ${Math.round(requiredMonthlySaving)} TWD/month.`;
      } else if (probability >= 40) {
        aiReason = `Moderate risk. You need ${Math.round(requiredMonthlySaving)} TWD/month but currently save ${Math.round(currentMonthlySaving)} TWD/month. Reduce expenses by ${Math.round(shortfall)} TWD to stay on track.`;
      } else {
        aiReason = `High risk. ${currentMonthlySaving <= 0 ? 'Your expenses exceed your income.' : `You need ${Math.round(requiredMonthlySaving)} TWD/month but can only save ${Math.round(currentMonthlySaving)} TWD/month.`} Consider extending your target date or increasing income.`;
      }
    }

    const forecast = await this.prisma.goalForecast.create({
      data: {
        goalId,
        userId,
        requiredMonthlySaving: requiredMonthlySaving,
        currentMonthlySaving: currentMonthlySaving,
        probability,
        riskLevel,
        aiReason,
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.GOAL_FORECAST_GENERATED,
      sourceModule: 'goals',
      payload: { goalId, forecastId: forecast.id, probability, riskLevel },
    });

    return this.mapForecast(forecast);
  }

  async findForecasts(userId: string, goalId: string) {
    await this.findOne(userId, goalId);
    const forecasts = await this.prisma.goalForecast.findMany({
      where: { goalId, userId },
      orderBy: { createdAt: 'desc' },
    });
    return forecasts.map(this.mapForecast);
  }

  // ─── Recommendations ─────────────────────────────────────────────────────────

  async getRecommendations(userId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({ where: { id: goalId, userId } });
    if (!goal) throw new NotFoundException('Goal not found');

    const [avgIncome, avgExpense] = await Promise.all([
      this.financeService.getAverageMonthlyIncome(userId),
      this.financeService.getAverageMonthlyExpense(userId),
    ]);

    const recommendations: string[] = [];

    if (avgIncome === 0 && avgExpense === 0) {
      recommendations.push('Record your income and expenses first to get personalized recommendations.');
      return { goalId, recommendations };
    }

    const targetAmount = goal.targetAmount ? toNum(goal.targetAmount) : null;
    const currentAmount = toNum(goal.currentAmount);
    const currentMonthlySaving = avgIncome - avgExpense;

    if (!targetAmount || !goal.targetDate) {
      recommendations.push('Set a target amount and target date for your goal to enable forecasting.');
      return { goalId, recommendations };
    }

    const remainingAmount = Math.max(0, targetAmount - currentAmount);
    const months = monthsBetween(new Date(), goal.targetDate);
    const requiredMonthlySaving = remainingAmount / months;

    if (currentMonthlySaving <= 0) {
      recommendations.push('Your expenses currently exceed your income. Track and reduce your spending to start saving.');
      recommendations.push('Consider finding additional income sources (freelance, tutoring, etc.).');
    } else if (currentMonthlySaving < requiredMonthlySaving) {
      const shortfall = Math.round(requiredMonthlySaving - currentMonthlySaving);
      recommendations.push(`You need to save ${Math.round(requiredMonthlySaving)} TWD/month but currently save ${Math.round(currentMonthlySaving)} TWD/month. Find ${shortfall} TWD extra per month.`);
      recommendations.push('Review your expense categories and identify items to reduce (entertainment, dining out, etc.).');
      recommendations.push('Consider extending your target date to reduce monthly pressure.');
      recommendations.push('Look for ways to increase income: overtime, freelance projects, or selling unused items.');
    } else {
      recommendations.push(`You are on track! Maintain your current savings rate of ${Math.round(currentMonthlySaving)} TWD/month.`);
      recommendations.push('Consider automating savings transfers on payday to avoid spending temptation.');
      if (currentMonthlySaving > requiredMonthlySaving * 1.2) {
        recommendations.push('You are saving more than required — consider investing the surplus for higher returns.');
      }
    }

    return { goalId, recommendations };
  }

  // ─── Mappers ─────────────────────────────────────────────────────────────────

  private mapGoal(g: {
    id: string; userId: string; goalType: string; title: string;
    targetAmount: DecimalLike; currentAmount: DecimalLike; targetDate: Date | null;
    priority: string; status: string; metadataJson: unknown;
    createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: g.id, userId: g.userId, goalType: g.goalType, title: g.title,
      targetAmount: toStr(g.targetAmount), currentAmount: toStr(g.currentAmount),
      targetDate: g.targetDate?.toISOString() ?? null, priority: g.priority,
      status: g.status, metadataJson: g.metadataJson,
      createdAt: g.createdAt.toISOString(), updatedAt: g.updatedAt.toISOString(),
    };
  }

  private mapMilestone(m: {
    id: string; goalId: string; userId: string; title: string;
    targetAmount: DecimalLike; targetDate: Date | null; isCompleted: boolean;
    completedAt: Date | null; createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: m.id, goalId: m.goalId, userId: m.userId, title: m.title,
      targetAmount: toStr(m.targetAmount), targetDate: m.targetDate?.toISOString() ?? null,
      isCompleted: m.isCompleted, completedAt: m.completedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString(),
    };
  }

  private mapForecast(f: {
    id: string; goalId: string; userId: string;
    requiredMonthlySaving: DecimalLike; currentMonthlySaving: DecimalLike;
    probability: number; riskLevel: string; forecastDate: Date; aiReason: string | null;
    createdAt: Date;
  }) {
    return {
      id: f.id, goalId: f.goalId, userId: f.userId,
      requiredMonthlySaving: toStr(f.requiredMonthlySaving),
      currentMonthlySaving: toStr(f.currentMonthlySaving),
      probability: f.probability, riskLevel: f.riskLevel,
      forecastDate: f.forecastDate.toISOString(), aiReason: f.aiReason,
      createdAt: f.createdAt.toISOString(),
    };
  }
}
