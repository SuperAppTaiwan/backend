import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ProfileService } from './profile.service.js';
import { UserHealthContextService } from './user-health-context.service.js';
import { AllergySeverity } from './dto/health-profile.dto.js';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  displayName: 'Test User',
  avatarUrl: null,
  status: 'ACTIVE',
};

const mockProfile = {
  id: 'profile-1',
  userId: 'user-1',
  locationCity: null,
  timezone: 'Asia/Taipei',
  currency: 'TWD',
  monthlyBudget: null,
  chineseLevel: null,
  dietPreference: null,
  livingStatus: null,
  familySupportMonthly: null,
  weightKg: null,
  heightCm: null,
  allergies: null,
  healthConditions: null,
  medications: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: mockUser,
};

const mockPrisma = {
  userProfile: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  user: {
    update: jest.fn(),
  },
};

const mockEvents = {
  publish: jest.fn().mockResolvedValue(undefined),
};

describe('ProfileService', () => {
  let service: ProfileService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        // Real implementation: it's pure/DB-free for the methods ProfileService
        // calls (calculateBmi, normalize*), so this exercises real BMI/dedup
        // logic through ProfileService rather than mocking it away.
        UserHealthContextService,
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  describe('getProfile', () => {
    it('should return profile for authenticated user', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      const result = await service.getProfile('user-1');

      expect(result.userId).toBe('user-1');
      expect(result.timezone).toBe('Asia/Taipei');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should throw NotFoundException if profile does not exist', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePreferences', () => {
    it('should update preferences and emit PROFILE_UPDATED event', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.userProfile.update.mockResolvedValue({
        ...mockProfile,
        chineseLevel: 'B1',
        currency: 'TWD',
      });

      const result = await service.updatePreferences('user-1', {
        chineseLevel: 'B1',
      });

      expect(result.userId).toBe('user-1');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'PROFILE_UPDATED' }),
      );
    });
  });

  describe('updateLocation', () => {
    it('should update location and emit event', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.userProfile.update.mockResolvedValue({
        ...mockProfile,
        locationCity: 'Taipei',
      });

      await service.updateLocation('user-1', { locationCity: 'Taipei' });

      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'PROFILE_UPDATED' }),
      );
    });
  });

  describe('getProfile — health profile / BMI', () => {
    it('computes BMI and category from stored weight/height', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue({ ...mockProfile, weightKg: 65, heightCm: 172 });

      const result = await service.getProfile('user-1');

      expect(result.healthProfile.weightKg).toBe(65);
      expect(result.healthProfile.heightCm).toBe(172);
      expect(result.healthProfile.bmi).toBeCloseTo(21.97, 1);
      expect(result.healthProfile.bmiCategory).toBe('Bình thường');
    });

    it('returns null bmi and empty arrays when no health data has been entered', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      const result = await service.getProfile('user-1');

      expect(result.healthProfile.bmi).toBeNull();
      expect(result.healthProfile.allergies).toEqual([]);
      expect(result.healthProfile.healthConditions).toEqual([]);
      expect(result.healthProfile.medications).toEqual([]);
    });
  });

  describe('updateHealthProfile', () => {
    it('adds allergies/conditions/medications and persists normalized data', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.userProfile.update.mockResolvedValue({
        ...mockProfile,
        weightKg: 70,
        heightCm: 175,
        allergies: [{ name: 'Tôm', severity: 'moderate' }],
        healthConditions: [{ name: 'Gout' }],
        medications: [{ name: 'Allopurinol' }],
      });

      const result = await service.updateHealthProfile('user-1', {
        weightKg: 70,
        heightCm: 175,
        allergies: [{ name: '  Tôm  ', severity: AllergySeverity.MODERATE }],
        healthConditions: [{ name: 'Gout' }],
        medications: [{ name: 'Allopurinol' }],
      });

      expect(mockPrisma.userProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            weightKg: 70,
            heightCm: 175,
            allergies: [{ name: 'Tôm', severity: 'moderate' }],
            healthConditions: [{ name: 'Gout' }],
            medications: [{ name: 'Allopurinol' }],
          }),
        }),
      );
      expect(result.healthProfile.allergies).toEqual([{ name: 'Tôm', severity: 'moderate' }]);
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'PROFILE_UPDATED',
          payload: expect.objectContaining({ fields: expect.arrayContaining(['health', 'weightKg', 'allergies']) }),
        }),
      );
      // Health values must never appear in the emitted event payload — only field names.
      expect(JSON.stringify(mockEvents.publish.mock.calls[0][0].payload)).not.toContain('Allopurinol');
    });

    it('clears weightKg with an explicit null and removes all allergies with an empty array', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue({ ...mockProfile, weightKg: 70, allergies: [{ name: 'Tôm' }] });
      mockPrisma.userProfile.update.mockResolvedValue({ ...mockProfile, weightKg: null, allergies: [] });

      await service.updateHealthProfile('user-1', { weightKg: null, allergies: [] });

      expect(mockPrisma.userProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ weightKg: null, allergies: [] }) }),
      );
    });

    it('leaves fields untouched when they are omitted from the update payload', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.userProfile.update.mockResolvedValue(mockProfile);

      await service.updateHealthProfile('user-1', { weightKg: 70 });

      const updateCall = mockPrisma.userProfile.update.mock.calls[0][0];
      expect(updateCall.data).toEqual({ weightKg: 70 });
      expect(updateCall.data).not.toHaveProperty('allergies');
    });

    it('creates the profile first if it does not yet exist (pre-migration user)', async () => {
      mockPrisma.userProfile.findUnique.mockResolvedValue(null);
      mockPrisma.userProfile.create.mockResolvedValue({ userId: 'user-1' });
      mockPrisma.userProfile.update.mockResolvedValue({ ...mockProfile, weightKg: 60 });

      await service.updateHealthProfile('user-1', { weightKg: 60 });

      expect(mockPrisma.userProfile.create).toHaveBeenCalledWith({ data: { userId: 'user-1' } });
    });
  });
});
