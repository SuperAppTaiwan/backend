import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { KnowledgeCategory, KnowledgeDifficulty } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { KnowledgeService } from './knowledge.service.js';
import { CreateArticleDto, UpdateArticleDto, CreateBookmarkDto } from './dto/knowledge.dto.js';

@ApiTags('Knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  // ─── Articles ──────────────────────────────────────────────────────────────

  @Get('articles')
  @ApiOperation({ summary: 'List knowledge articles with optional filters' })
  @ApiQuery({ name: 'category', required: false, enum: KnowledgeCategory })
  @ApiQuery({ name: 'difficulty', required: false, enum: KnowledgeDifficulty })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'List of articles' })
  getArticles(
    @Query('category') category?: KnowledgeCategory,
    @Query('difficulty') difficulty?: KnowledgeDifficulty,
    @Query('search') search?: string,
  ) {
    return this.knowledgeService.getArticles({ category, difficulty, search });
  }

  @Get('articles/featured')
  @ApiOperation({ summary: 'Get featured/top-viewed articles' })
  @ApiResponse({ status: 200, description: 'Top articles by view count' })
  getFeaturedArticles() {
    return this.knowledgeService.getFeaturedArticles();
  }

  @Get('articles/:id')
  @ApiOperation({ summary: 'Get article detail (increments view count)' })
  @ApiResponse({ status: 200, description: 'Article detail with bookmark status' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getArticle(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.knowledgeService.getArticle(user.userId, id);
  }

  @Post('articles')
  @ApiOperation({ summary: 'Create a new knowledge article' })
  @ApiResponse({ status: 201, description: 'Article created' })
  createArticle(@CurrentUser() user: AuthUser, @Body() dto: CreateArticleDto) {
    return this.knowledgeService.createArticle(user.userId, dto);
  }

  @Put('articles/:id')
  @ApiOperation({ summary: 'Update article (author only)' })
  @ApiResponse({ status: 200, description: 'Article updated' })
  @ApiResponse({ status: 404, description: 'Not found or not author' })
  updateArticle(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateArticleDto) {
    return this.knowledgeService.updateArticle(user.userId, id, dto);
  }

  @Delete('articles/:id')
  @ApiOperation({ summary: 'Delete article (author only)' })
  @ApiResponse({ status: 200, description: 'Article deleted' })
  @ApiResponse({ status: 404, description: 'Not found or not author' })
  deleteArticle(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.knowledgeService.deleteArticle(user.userId, id);
  }

  // ─── Bookmarks ─────────────────────────────────────────────────────────────

  @Get('bookmarks')
  @ApiOperation({ summary: 'Get user bookmarked articles' })
  @ApiResponse({ status: 200, description: 'Bookmarked articles' })
  getBookmarks(@CurrentUser() user: AuthUser) {
    return this.knowledgeService.getBookmarks(user.userId);
  }

  @Post('bookmarks/:articleId')
  @ApiOperation({ summary: 'Bookmark an article' })
  @ApiResponse({ status: 201, description: 'Bookmark added' })
  @ApiResponse({ status: 409, description: 'Already bookmarked' })
  addBookmark(
    @CurrentUser() user: AuthUser,
    @Param('articleId') articleId: string,
    @Body() dto: CreateBookmarkDto,
  ) {
    return this.knowledgeService.addBookmark(user.userId, articleId, dto);
  }

  @Delete('bookmarks/:articleId')
  @ApiOperation({ summary: 'Remove bookmark' })
  @ApiResponse({ status: 200, description: 'Bookmark removed' })
  @ApiResponse({ status: 404, description: 'Bookmark not found' })
  removeBookmark(@CurrentUser() user: AuthUser, @Param('articleId') articleId: string) {
    return this.knowledgeService.removeBookmark(user.userId, articleId);
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  @Get('search')
  @ApiOperation({ summary: 'Search articles by keyword' })
  @ApiQuery({ name: 'q', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Matching articles' })
  searchArticles(@Query('q') q: string) {
    return this.knowledgeService.searchArticles(q ?? '');
  }
}
