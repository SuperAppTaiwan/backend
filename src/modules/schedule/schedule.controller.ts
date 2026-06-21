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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { ScheduleService } from './schedule.service.js';
import { CreateFixedEventDto, UpdateFixedEventDto } from './dto/create-fixed-event.dto.js';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto.js';
import { AutoPlanDto, DateQueryDto } from './dto/auto-plan.dto.js';

@ApiTags('Schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  // ─── Fixed Events ─────────────────────────────────────────────────────────────

  @Post('fixed-events')
  @ApiOperation({ summary: 'Create fixed event' })
  @ApiResponse({ status: 201, description: 'Fixed event created' })
  createFixedEvent(@CurrentUser() user: AuthUser, @Body() dto: CreateFixedEventDto) {
    return this.scheduleService.createFixedEvent(user.userId, dto);
  }

  @Get('fixed-events')
  @ApiOperation({ summary: 'List all fixed events' })
  findAllFixedEvents(@CurrentUser() user: AuthUser) {
    return this.scheduleService.findAllFixedEvents(user.userId);
  }

  @Get('fixed-events/:id')
  @ApiOperation({ summary: 'Get fixed event by ID' })
  findFixedEvent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduleService.findFixedEvent(user.userId, id);
  }

  @Put('fixed-events/:id')
  @ApiOperation({ summary: 'Update fixed event' })
  updateFixedEvent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFixedEventDto,
  ) {
    return this.scheduleService.updateFixedEvent(user.userId, id, dto);
  }

  @Delete('fixed-events/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete fixed event' })
  deleteFixedEvent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduleService.deleteFixedEvent(user.userId, id);
  }

  // ─── Tasks ────────────────────────────────────────────────────────────────────

  @Post('tasks')
  @ApiOperation({ summary: 'Create task' })
  @ApiResponse({ status: 201, description: 'Task created' })
  createTask(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto) {
    return this.scheduleService.createTask(user.userId, dto);
  }

  @Get('tasks')
  @ApiOperation({ summary: 'List all tasks' })
  findAllTasks(@CurrentUser() user: AuthUser) {
    return this.scheduleService.findAllTasks(user.userId);
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Get task by ID' })
  findTask(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduleService.findTask(user.userId, id);
  }

  @Put('tasks/:id')
  @ApiOperation({ summary: 'Update task' })
  updateTask(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.scheduleService.updateTask(user.userId, id, dto);
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete task' })
  deleteTask(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduleService.deleteTask(user.userId, id);
  }

  @Post('tasks/:id/complete')
  @ApiOperation({ summary: 'Mark task as completed' })
  completeTask(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduleService.completeTask(user.userId, id);
  }

  // ─── Planning ─────────────────────────────────────────────────────────────────

  @Post('auto-plan')
  @ApiOperation({ summary: 'Auto-schedule pending tasks around fixed events for a date' })
  @ApiResponse({ status: 201, description: 'Schedule plan generated' })
  autoSchedule(@CurrentUser() user: AuthUser, @Body() dto: AutoPlanDto) {
    return this.scheduleService.autoSchedule(user.userId, dto);
  }

  @Post('reschedule')
  @ApiOperation({ summary: 'Reschedule tasks for a date (clears existing scheduled slots)' })
  reschedule(@CurrentUser() user: AuthUser, @Body() dto: AutoPlanDto) {
    return this.scheduleService.reschedule(user.userId, dto);
  }

  @Get('daily-plan')
  @ApiOperation({ summary: 'Get daily plan for a date' })
  @ApiQuery({ name: 'date', example: '2026-07-01' })
  getDailyPlan(@CurrentUser() user: AuthUser, @Query() query: DateQueryDto) {
    return this.scheduleService.getDailyPlan(user.userId, query.date);
  }

  @Get('conflicts')
  @ApiOperation({ summary: 'Detect scheduling conflicts for a date' })
  @ApiQuery({ name: 'date', example: '2026-07-01' })
  getConflicts(@CurrentUser() user: AuthUser, @Query() query: DateQueryDto) {
    return this.scheduleService.getConflicts(user.userId, query.date);
  }

  @Get('productivity-insights')
  @ApiOperation({ summary: 'Get productivity insights (completion rate, overdue, suggestions)' })
  getProductivityInsights(@CurrentUser() user: AuthUser) {
    return this.scheduleService.getProductivityInsights(user.userId);
  }
}
