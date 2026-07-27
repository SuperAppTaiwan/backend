import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { AllergySeverity, HealthConditionStatus } from '../profile/dto/health-profile.dto.js';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  passwordHash: '',
  displayName: 'Test User',
  avatarUrl: null,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock-access-token'),
};

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('test-secret'),
};

const mockEvents = {
  publish: jest.fn().mockResolvedValue(undefined),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EventsService, useValue: mockEvents },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ ...mockUser, displayName: 'Test User' });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.register({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      });

      expect(result.tokens.accessToken).toBe('mock-access-token');
      expect(result.tokens.refreshToken).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'USER_REGISTERED' }),
      );
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123',
          displayName: 'Test User',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should normalize email to lowercase', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      await service.register({
        email: 'TEST@EXAMPLE.COM',
        password: 'password123',
        displayName: 'Test User',
      });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });

    it('should register successfully with full health information and persist it on the nested profile create', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      await service.register({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
        weightKg: 65,
        heightCm: 172,
        allergies: [{ name: 'Đậu phộng', severity: AllergySeverity.SEVERE }, { name: 'đậu phộng' }], // dup, case-insensitive
        healthConditions: [{ name: 'Tiểu đường', status: HealthConditionStatus.ACTIVE }],
        medications: [{ name: 'Metformin', dosage: '500mg' }],
      });

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            profile: expect.objectContaining({
              create: expect.objectContaining({
                weightKg: 65,
                heightCm: 172,
                allergies: [{ name: 'Đậu phộng', severity: 'severe' }], // deduplicated
                healthConditions: [{ name: 'Tiểu đường', status: 'active' }],
                medications: [{ name: 'Metformin', dosage: '500mg' }],
              }),
            }),
          }),
        }),
      );
    });

    it('should register successfully without any health information (backward compatible)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.register({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      });

      expect(result.user.email).toBe('test@example.com');
      const createCall = mockPrisma.user.create.mock.calls[0][0];
      expect(createCall.data.profile.create).toEqual({});
    });
  });

  describe('login', () => {
    it('should login successfully with correct credentials', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, passwordHash });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.tokens.accessToken).toBe('mock-access-token');
      expect(result.user.email).toBe('test@example.com');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'USER_LOGGED_IN' }),
      );
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 10);
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, passwordHash });

      await expect(
        service.login({ email: 'test@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshToken', () => {
    it('should return new access token for valid refresh token', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        user: { ...mockUser, status: 'ACTIVE' },
      });

      const result = await service.refreshToken('valid-refresh-token');

      expect(result.accessToken).toBe('mock-access-token');
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.refreshToken('invalid-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getMe', () => {
    it('should return user with profile', async () => {
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        ...mockUser,
        profile: {
          timezone: 'Asia/Taipei',
          currency: 'TWD',
          locationCity: null,
          monthlyBudget: null,
          chineseLevel: null,
          dietPreference: null,
          livingStatus: null,
          familySupportMonthly: null,
        },
      });

      const result = await service.getMe('user-1');

      expect(result.id).toBe('user-1');
      expect(result.profile).toBeDefined();
      expect(result.profile?.timezone).toBe('Asia/Taipei');
    });
  });
});
