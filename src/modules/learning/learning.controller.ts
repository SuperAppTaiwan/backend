import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { LearningService } from './learning.service.js';
import { CreateVocabularyDto } from './dto/create-vocabulary.dto.js';
import { UpdateVocabularyDto } from './dto/update-vocabulary.dto.js';
import { ReviewDto } from './dto/review.dto.js';
import { CreateLearningPlanDto, UpdateLearningPlanDto } from './dto/create-learning-plan.dto.js';
import { HskPlanDto } from './dto/hsk-plan.dto.js';

@ApiTags('Learning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('learning')
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  // ─── Vocabulary ──────────────────────────────────────────────────────────────

  @Get('daily-vocabulary')
  @ApiOperation({ summary: 'Get daily vocabulary words for review/learning' })
  getDailyVocabulary(@CurrentUser() user: AuthUser) {
    return this.learningService.getDailyVocabulary(user.userId);
  }

  @Get('vocabularies')
  @ApiOperation({ summary: 'List all vocabulary' })
  findAllVocabularies() {
    return this.learningService.findAllVocabularies();
  }

  @Get('vocabularies/:id')
  @ApiOperation({ summary: 'Get vocabulary by ID' })
  findVocabulary(@Param('id') id: string) {
    return this.learningService.findVocabularyById(id);
  }

  @Post('vocabularies')
  @ApiOperation({ summary: 'Create custom vocabulary' })
  @ApiResponse({ status: 201, description: 'Vocabulary created' })
  createVocabulary(@CurrentUser() user: AuthUser, @Body() dto: CreateVocabularyDto) {
    return this.learningService.createVocabulary(user.userId, dto);
  }

  @Put('vocabularies/:id')
  @ApiOperation({ summary: 'Update vocabulary' })
  updateVocabulary(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateVocabularyDto,
  ) {
    return this.learningService.updateVocabulary(user.userId, id, dto);
  }

  @Delete('vocabularies/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete vocabulary' })
  deleteVocabulary(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.learningService.deleteVocabulary(user.userId, id);
  }

  @Post('vocabularies/:id/learned')
  @ApiOperation({ summary: 'Mark vocabulary as learned' })
  markLearned(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.learningService.markLearned(user.userId, id);
  }

  @Post('vocabularies/:id/bookmark')
  @ApiOperation({ summary: 'Bookmark vocabulary for active learning' })
  bookmark(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.learningService.bookmarkVocabulary(user.userId, id);
  }

  // ─── Review ──────────────────────────────────────────────────────────────────

  @Post('review')
  @ApiOperation({ summary: 'Submit a vocabulary review (spaced repetition)' })
  @ApiResponse({ status: 201, description: 'Review submitted' })
  submitReview(@CurrentUser() user: AuthUser, @Body() dto: ReviewDto) {
    return this.learningService.submitReview(user.userId, dto);
  }

  @Get('progress')
  @ApiOperation({ summary: 'Get learning progress summary' })
  getProgress(@CurrentUser() user: AuthUser) {
    return this.learningService.getProgress(user.userId);
  }

  // ─── Learning Plan ───────────────────────────────────────────────────────────

  @Post('plan')
  @ApiOperation({ summary: 'Create learning plan' })
  @ApiResponse({ status: 201, description: 'Plan created' })
  createPlan(@CurrentUser() user: AuthUser, @Body() dto: CreateLearningPlanDto) {
    return this.learningService.createPlan(user.userId, dto);
  }

  @Get('plan')
  @ApiOperation({ summary: 'List all learning plans' })
  getPlans(@CurrentUser() user: AuthUser) {
    return this.learningService.getPlans(user.userId);
  }

  @Put('plan/:id')
  @ApiOperation({ summary: 'Update learning plan' })
  updatePlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLearningPlanDto,
  ) {
    return this.learningService.updatePlan(user.userId, id, dto);
  }

  @Post('hsk-plan')
  @ApiOperation({ summary: 'Generate deterministic HSK learning plan' })
  @ApiResponse({ status: 201, description: 'HSK plan generated' })
  createHskPlan(@CurrentUser() user: AuthUser, @Body() dto: HskPlanDto) {
    return this.learningService.createHskPlan(user.userId, dto);
  }

  @Get('weekly-report')
  @ApiOperation({ summary: 'Get weekly learning report' })
  getWeeklyReport(@CurrentUser() user: AuthUser) {
    return this.learningService.getWeeklyReport(user.userId);
  }
}
