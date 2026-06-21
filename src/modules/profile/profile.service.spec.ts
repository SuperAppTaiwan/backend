import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ProfileService } from './profile.service.js';

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
});
