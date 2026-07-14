import {
  BadRequestException,
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
import { ScheduleEventsService, ScheduleScope, ScheduleSourceType } from './schedule-events.service.js';
import { CreateFixedEventDto, UpdateFixedEventDto } from './dto/create-fixed-event.dto.js';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto.js';
import { AutoPlanDto, DateQueryDto } from './dto/auto-plan.dto.js';
import {
  ConflictCheckDto,
  CreateScheduleEventDto,
  ScheduleEventQueryDto,
  UpdateScheduleEventDto,
} from './dto/schedule-event.dto.js';

const VALID_SOURCE_TYPES: ScheduleSourceType[] = ['fixed-event', 'task'];
const VALID_SCOPES: ScheduleScope[] = ['THIS', 'FOLLOWING', 'SERIES'];

@ApiTags('Schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(
    private readonly scheduleService: ScheduleService,
    private readonly scheduleEventsService: ScheduleEventsService,
  ) {}

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

  // ─── Unified Schedule Events (FixedEvent + Task, recurrence + AI auto-scheduling) ─────────────

  private assertSourceType(sourceType: string): ScheduleSourceType {
    if (!VALID_SOURCE_TYPES.includes(sourceType as ScheduleSourceType)) {
      throw new BadRequestException('sourceType must be "fixed-event" or "task"');
    }
    return sourceType as ScheduleSourceType;
  }

  private assertScope(scope?: string): ScheduleScope | undefined {
    if (scope === undefined) return undefined;
    if (!VALID_SCOPES.includes(scope as ScheduleScope)) {
      throw new BadRequestException('scope must be one of THIS, FOLLOWING, SERIES');
    }
    return scope as ScheduleScope;
  }

  @Get('events')
  @ApiOperation({ summary: 'List unified schedule items (fixed events + tasks, recurrence-expanded) in a date range' })
  @ApiQuery({ name: 'from', example: '2026-07-01T00:00:00.000Z' })
  @ApiQuery({ name: 'to', example: '2026-07-31T23:59:59.000Z' })
  listEvents(@CurrentUser() user: AuthUser, @Query() query: ScheduleEventQueryDto) {
    return this.scheduleEventsService.listEvents(user.userId, new Date(query.from), new Date(query.to));
  }

  @Post('events')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a schedule event (FIXED = user-committed time, AI_AUTO = AI-placed)' })
  @ApiResponse({ status: 201, description: 'Schedule event created' })
  @ApiResponse({ status: 409, description: 'Schedule conflict (FIXED mode, forceCreate not set)' })
  @ApiResponse({ status: 422, description: 'No AI slot available (AI_AUTO mode, allowUnscheduled not set)' })
  createEvent(@CurrentUser() user: AuthUser, @Body() dto: CreateScheduleEventDto) {
    return this.scheduleEventsService.createEvent(user.userId, dto);
  }

  @Put('events/:sourceType/:id')
  @ApiOperation({ summary: 'Update a schedule event (scope: THIS | FOLLOWING | SERIES, default SERIES)' })
  @ApiQuery({ name: 'scope', required: false, enum: ['THIS', 'FOLLOWING', 'SERIES'] })
  @ApiQuery({ name: 'occurrenceStart', required: false, example: '2026-07-13T09:00:00.000Z' })
  updateEvent(
    @CurrentUser() user: AuthUser,
    @Param('sourceType') sourceType: string,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleEventDto,
    @Query('scope') scope?: string,
    @Query('occurrenceStart') occurrenceStart?: string,
  ) {
    const validSourceType = this.assertSourceType(sourceType);
    const validScope = this.assertScope(scope);
    return this.scheduleEventsService.updateEvent(
      user.userId,
      validSourceType,
      id,
      dto,
      validScope ?? 'SERIES',
      occurrenceStart ? new Date(occurrenceStart) : undefined,
    );
  }

  @Delete('events/:sourceType/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a schedule event (scope: THIS | FOLLOWING | SERIES, default SERIES)' })
  @ApiQuery({ name: 'scope', required: false, enum: ['THIS', 'FOLLOWING', 'SERIES'] })
  @ApiQuery({ name: 'occurrenceStart', required: false, example: '2026-07-13T09:00:00.000Z' })
  deleteEvent(
    @CurrentUser() user: AuthUser,
    @Param('sourceType') sourceType: string,
    @Param('id') id: string,
    @Query('scope') scope?: string,
    @Query('occurrenceStart') occurrenceStart?: string,
  ) {
    const validSourceType = this.assertSourceType(sourceType);
    const validScope = this.assertScope(scope);
    return this.scheduleEventsService.deleteEvent(
      user.userId,
      validSourceType,
      id,
      validScope ?? 'SERIES',
      occurrenceStart ? new Date(occurrenceStart) : undefined,
    );
  }

  @Post('conflicts/check')
  @ApiOperation({ summary: 'Check whether a proposed time range conflicts with existing FIXED-mode items' })
  checkConflicts(@CurrentUser() user: AuthUser, @Body() dto: ConflictCheckDto) {
    return this.scheduleEventsService.checkConflicts(user.userId, new Date(dto.startAt), new Date(dto.endAt), dto.excludeId);
  }
}
