import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { normalizeAllergies, normalizeHealthConditions, normalizeMedications } from '../profile/health-profile.util.js';

const REFRESH_TOKEN_EXPIRES_DAYS = 30;
const ACCESS_TOKEN_EXPIRES = '15m';
const BCRYPT_ROUNDS = 12;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserPayload {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
}

export interface AuthResponse {
  tokens: TokenPair;
  user: UserPayload;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: EventsService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Health fields are all optional at registration. The nested `profile.create`
    // is wrapped in Prisma's implicit transaction (supported on MongoDB replica
    // sets), so a failure here rolls back the whole user creation rather than
    // leaving a partially-created account.
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        displayName: dto.displayName.trim(),
        profile: {
          create: {
            ...(dto.weightKg !== undefined && dto.weightKg !== null && { weightKg: dto.weightKg }),
            ...(dto.heightCm !== undefined && dto.heightCm !== null && { heightCm: dto.heightCm }),
            ...(dto.allergies && { allergies: normalizeAllergies(dto.allergies) as unknown as Prisma.InputJsonValue }),
            ...(dto.healthConditions && { healthConditions: normalizeHealthConditions(dto.healthConditions) as unknown as Prisma.InputJsonValue }),
            ...(dto.medications && { medications: normalizeMedications(dto.medications) as unknown as Prisma.InputJsonValue }),
          },
        },
      },
    });

    const tokens = await this.createTokenPair(user.id, user.email);

    await this.events.publish({
      userId: user.id,
      eventType: EventType.USER_REGISTERED,
      sourceModule: 'auth',
      payload: { email: user.email, displayName: user.displayName },
    });

    return {
      tokens,
      user: this.toUserPayload(user),
    };
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    const tokens = await this.createTokenPair(user.id, user.email);

    await this.events.publish({
      userId: user.id,
      eventType: EventType.USER_LOGGED_IN,
      sourceModule: 'auth',
      payload: { email: user.email },
    });

    return {
      tokens,
      user: this.toUserPayload(user),
    };
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    const tokenHash = this.hashToken(refreshToken);

    const stored = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!stored || stored.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const accessToken = this.signAccessToken(stored.userId, stored.user.email);

    return { accessToken, expiresIn: 900 };
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);

    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string): Promise<UserPayload & { profile: Record<string, unknown> | null }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });

    return {
      ...this.toUserPayload(user),
      profile: user.profile
        ? {
            locationCity: user.profile.locationCity,
            timezone: user.profile.timezone,
            currency: user.profile.currency,
            monthlyBudget: user.profile.monthlyBudget?.toString() ?? null,
            chineseLevel: user.profile.chineseLevel,
            dietPreference: user.profile.dietPreference,
            livingStatus: user.profile.livingStatus,
            familySupportMonthly: user.profile.familySupportMonthly?.toString() ?? null,
          }
        : null,
    };
  }

  private async createTokenPair(userId: string, email: string): Promise<TokenPair> {
    const accessToken = this.signAccessToken(userId, email);

    const plainRefreshToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(plainRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt, revokedAt: null },
    });

    return {
      accessToken,
      refreshToken: plainRefreshToken,
      expiresIn: 900,
    };
  }

  private signAccessToken(userId: string, email: string): string {
    return this.jwt.sign({ sub: userId, email }, { expiresIn: ACCESS_TOKEN_EXPIRES });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toUserPayload(user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    status: string;
  }): UserPayload {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      status: user.status,
    };
  }
}
