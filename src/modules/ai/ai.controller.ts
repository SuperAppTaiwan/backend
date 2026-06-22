import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { AIService } from './ai.service.js';
import { ChatRequestDto, CreateConversationDto, SendMessageDto } from './dto/ai.dto.js';

@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get AI profile scores' })
  @ApiResponse({ status: 200, description: 'AI profile' })
  getProfile(@CurrentUser() user: AuthUser) {
    return this.aiService.getProfile(user.userId);
  }

  @Post('recommendations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate AI recommendations' })
  @ApiResponse({ status: 200, description: 'Recommendations generated' })
  generateRecommendations(@CurrentUser() user: AuthUser) {
    return this.aiService.generateRecommendations(user.userId);
  }

  @Get('recommendations')
  @ApiOperation({ summary: 'List AI suggestions' })
  getSuggestions(@CurrentUser() user: AuthUser) {
    return this.aiService.getSuggestions(user.userId);
  }

  @Put('recommendations/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an AI suggestion' })
  acceptSuggestion(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.aiService.acceptSuggestion(user.userId, id);
  }

  @Put('recommendations/:id/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dismiss an AI suggestion' })
  dismissSuggestion(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.aiService.dismissSuggestion(user.userId, id);
  }

  @Get('daily-summary')
  @ApiOperation({ summary: 'Get AI daily summary' })
  getDailySummary(@CurrentUser() user: AuthUser) {
    return this.aiService.getDailySummary(user.userId);
  }

  @Get('weekly-report')
  @ApiOperation({ summary: 'Get AI weekly report' })
  getWeeklyReport(@CurrentUser() user: AuthUser) {
    return this.aiService.getWeeklyReport(user.userId);
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chat with AI assistant' })
  @ApiResponse({ status: 200, description: 'Chat response' })
  chat(@CurrentUser() user: AuthUser, @Body() dto: ChatRequestDto) {
    return this.aiService.chat(user.userId, dto.messages);
  }

  @Post('analyze-goals')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Analyze goals with AI' })
  analyzeGoals(@CurrentUser() user: AuthUser) {
    return this.aiService.analyzeGoals(user.userId);
  }

  @Post('analyze-budget')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Analyze budget with AI' })
  analyzeBudget(@CurrentUser() user: AuthUser) {
    return this.aiService.analyzeBudget(user.userId);
  }

  @Post('optimize-schedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get schedule optimization suggestions' })
  optimizeSchedule(@CurrentUser() user: AuthUser) {
    return this.aiService.optimizeSchedule(user.userId);
  }

  @Post('optimize-learning')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get learning optimization suggestions' })
  optimizeLearning(@CurrentUser() user: AuthUser) {
    return this.aiService.optimizeLearning(user.userId);
  }

  // ─── Conversations ───────────────────────────────────────────────────────────

  @Get('conversations')
  @ApiOperation({ summary: 'List AI conversations' })
  @ApiResponse({ status: 200, description: 'Conversations list' })
  listConversations(@CurrentUser() user: AuthUser) {
    return this.aiService.listConversations(user.userId);
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Create a new conversation' })
  @ApiResponse({ status: 201, description: 'Conversation created' })
  createConversation(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) {
    return this.aiService.createConversation(user.userId, dto.title);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get conversation messages' })
  @ApiResponse({ status: 200, description: 'Messages list' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  getMessages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.aiService.getConversationMessages(user.userId, id);
  }

  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send message and get AI response' })
  @ApiResponse({ status: 200, description: 'AI response with message persisted' })
  sendMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.aiService.sendConversationMessage(user.userId, id, dto.content);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a conversation' })
  @ApiResponse({ status: 200, description: 'Conversation deleted' })
  deleteConversation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.aiService.deleteConversation(user.userId, id);
  }
}
