import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { ProfileService } from './profile.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UpdatePreferencesDto } from './dto/update-preferences.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';
import { UpdateFamilySupportDto } from './dto/update-family-support.dto.js';

@ApiTags('Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Profile data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getProfile(@CurrentUser() user: AuthUser) {
    return this.profileService.getProfile(user.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Update profile (displayName, avatarUrl)' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.profileService.updateProfile(user.userId, dto);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update preferences (language, diet, budget, etc.)' })
  @ApiResponse({ status: 200, description: 'Preferences updated' })
  updatePreferences(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return this.profileService.updatePreferences(user.userId, dto);
  }

  @Put('location')
  @ApiOperation({ summary: 'Update location city' })
  @ApiResponse({ status: 200, description: 'Location updated' })
  updateLocation(@CurrentUser() user: AuthUser, @Body() dto: UpdateLocationDto) {
    return this.profileService.updateLocation(user.userId, dto);
  }

  @Put('family-support')
  @ApiOperation({ summary: 'Update monthly family support amount' })
  @ApiResponse({ status: 200, description: 'Family support updated' })
  updateFamilySupport(@CurrentUser() user: AuthUser, @Body() dto: UpdateFamilySupportDto) {
    return this.profileService.updateFamilySupport(user.userId, dto);
  }
}
