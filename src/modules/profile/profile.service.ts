import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdatePreferencesDto } from './dto/update-preferences.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';
import { UpdateFamilySupportDto } from './dto/update-family-support.dto.js';
import { UpdateHealthProfileDto } from './dto/health-profile.dto.js';
import { UserHealthContextService, type HealthProfileSnapshot } from './user-health-context.service.js';

export interface ProfileResponse {
  id: string;
  userId: string;
  locationCity: string | null;
  timezone: string;
  currency: string;
  monthlyBudget: string | null;
  chineseLevel: string | null;
  dietPreference: string | null;
  livingStatus: string | null;
  familySupportMonthly: string | null;
  healthProfile: HealthProfileSnapshot;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    status: string;
  };
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly healthContext: UserHealthContextService,
  ) {}

  async getProfile(userId: string): Promise<ProfileResponse> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return this.toResponse(profile);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileResponse> {
    await this.ensureProfileExists(userId);

    if (dto.displayName !== undefined || dto.avatarUrl !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.displayName && { displayName: dto.displayName.trim() }),
          ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
        },
      });
    }

    const profile = await this.prisma.userProfile.update({
      where: { userId },
      data: {},
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.PROFILE_UPDATED,
      sourceModule: 'profile',
      payload: { fields: Object.keys(dto) },
    });

    return this.toResponse(profile);
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<ProfileResponse> {
    await this.ensureProfileExists(userId);

    const profile = await this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...(dto.chineseLevel !== undefined && { chineseLevel: dto.chineseLevel }),
        ...(dto.dietPreference !== undefined && { dietPreference: dto.dietPreference }),
        ...(dto.livingStatus !== undefined && { livingStatus: dto.livingStatus }),
        ...(dto.monthlyBudget !== undefined && { monthlyBudget: dto.monthlyBudget }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.PROFILE_UPDATED,
      sourceModule: 'profile',
      payload: { fields: ['preferences'], ...dto },
    });

    return this.toResponse(profile);
  }

  async updateLocation(userId: string, dto: UpdateLocationDto): Promise<ProfileResponse> {
    await this.ensureProfileExists(userId);

    const profile = await this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...(dto.locationCity !== undefined && { locationCity: dto.locationCity }),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.PROFILE_UPDATED,
      sourceModule: 'profile',
      payload: { fields: ['location'], locationCity: dto.locationCity },
    });

    return this.toResponse(profile);
  }

  async updateFamilySupport(userId: string, dto: UpdateFamilySupportDto): Promise<ProfileResponse> {
    await this.ensureProfileExists(userId);

    const profile = await this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...(dto.familySupportMonthly !== undefined && {
          familySupportMonthly: dto.familySupportMonthly,
        }),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.PROFILE_UPDATED,
      sourceModule: 'profile',
      payload: { fields: ['familySupport'], familySupportMonthly: dto.familySupportMonthly },
    });

    return this.toResponse(profile);
  }

  private async ensureProfileExists(userId: string): Promise<void> {
    const exists = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!exists) {
      await this.prisma.userProfile.create({ data: { userId } });
    }
  }

  private toResponse(profile: {
    id: string;
    userId: string;
    locationCity: string | null;
    timezone: string;
    currency: string;
    monthlyBudget: { toString(): string } | null;
    chineseLevel: string | null;
    dietPreference: string | null;
    livingStatus: string | null;
    familySupportMonthly: { toString(): string } | null;
    weightKg: number | null;
    heightCm: number | null;
    allergies: unknown;
    healthConditions: unknown;
    medications: unknown;
    createdAt: Date;
    updatedAt: Date;
    user: {
      id: string;
      email: string;
      displayName: string;
      avatarUrl: string | null;
      status: string;
    };
  }): ProfileResponse {
    const { bmi, bmiCategory } = this.healthContext.calculateBmi(profile.weightKg, profile.heightCm);

    return {
      id: profile.id,
      userId: profile.userId,
      locationCity: profile.locationCity,
      timezone: profile.timezone,
      currency: profile.currency,
      monthlyBudget: profile.monthlyBudget?.toString() ?? null,
      chineseLevel: profile.chineseLevel,
      dietPreference: profile.dietPreference,
      livingStatus: profile.livingStatus,
      familySupportMonthly: profile.familySupportMonthly?.toString() ?? null,
      healthProfile: {
        weightKg: profile.weightKg,
        heightCm: profile.heightCm,
        bmi,
        bmiCategory,
        allergies: this.healthContext.normalizeAllergies(profile.allergies),
        healthConditions: this.healthContext.normalizeHealthConditions(profile.healthConditions),
        medications: this.healthContext.normalizeMedications(profile.medications),
      },
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      user: profile.user,
    };
  }

  async updateHealthProfile(userId: string, dto: UpdateHealthProfileDto): Promise<ProfileResponse> {
    await this.ensureProfileExists(userId);

    const changedFields = (
      [
        ['weightKg', dto.weightKg],
        ['heightCm', dto.heightCm],
        ['allergies', dto.allergies],
        ['healthConditions', dto.healthConditions],
        ['medications', dto.medications],
      ] as const
    )
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field);

    const profile = await this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...(dto.weightKg !== undefined && { weightKg: dto.weightKg }),
        ...(dto.heightCm !== undefined && { heightCm: dto.heightCm }),
        ...(dto.allergies !== undefined && { allergies: this.healthContext.normalizeAllergies(dto.allergies) as unknown as Prisma.InputJsonValue }),
        ...(dto.healthConditions !== undefined && { healthConditions: this.healthContext.normalizeHealthConditions(dto.healthConditions) as unknown as Prisma.InputJsonValue }),
        ...(dto.medications !== undefined && { medications: this.healthContext.normalizeMedications(dto.medications) as unknown as Prisma.InputJsonValue }),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            status: true,
          },
        },
      },
    });

    // Health data is sensitive — log only which fields changed, never values.
    await this.events.publish({
      userId,
      eventType: EventType.PROFILE_UPDATED,
      sourceModule: 'profile',
      payload: { fields: ['health', ...changedFields] },
    });

    return this.toResponse(profile);
  }
}
