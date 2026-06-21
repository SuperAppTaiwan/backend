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
import { GoalsService } from './goals.service.js';
import { CreateGoalDto } from './dto/create-goal.dto.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';
import { CreateMilestoneDto, UpdateMilestoneDto } from './dto/create-milestone.dto.js';

@ApiTags('Goals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  // ─── Goals ───────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a goal' })
  @ApiResponse({ status: 201, description: 'Goal created' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGoalDto) {
    return this.goalsService.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all goals' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.goalsService.findAll(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get goal by ID' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.goalsService.findOne(user.userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update goal' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateGoalDto) {
    return this.goalsService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete goal' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.goalsService.remove(user.userId, id);
  }

  // ─── Milestones ──────────────────────────────────────────────────────────────

  @Post(':id/milestones')
  @ApiOperation({ summary: 'Create milestone for goal' })
  @ApiResponse({ status: 201, description: 'Milestone created' })
  createMilestone(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.goalsService.createMilestone(user.userId, id, dto);
  }

  @Get(':id/milestones')
  @ApiOperation({ summary: 'List milestones for goal' })
  findMilestones(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.goalsService.findMilestones(user.userId, id);
  }

  @Put(':id/milestones/:milestoneId')
  @ApiOperation({ summary: 'Update milestone' })
  updateMilestone(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('milestoneId') milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.goalsService.updateMilestone(user.userId, id, milestoneId, dto);
  }

  @Delete(':id/milestones/:milestoneId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete milestone' })
  removeMilestone(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return this.goalsService.removeMilestone(user.userId, id, milestoneId);
  }

  // ─── Forecast ─────────────────────────────────────────────────────────────────

  @Post(':id/forecast')
  @ApiOperation({ summary: 'Generate goal forecast' })
  @ApiResponse({ status: 201, description: 'Forecast generated' })
  generateForecast(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.goalsService.generateForecast(user.userId, id);
  }

  @Get(':id/forecasts')
  @ApiOperation({ summary: 'Get forecast history for goal' })
  findForecasts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.goalsService.findForecasts(user.userId, id);
  }

  @Get(':id/recommendations')
  @ApiOperation({ summary: 'Get actionable recommendations for goal' })
  getRecommendations(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.goalsService.getRecommendations(user.userId, id);
  }
}
