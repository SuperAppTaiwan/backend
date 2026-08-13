import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { VocabNotebookService } from './vocab-notebook.service.js';
import { CreateVocabCategoryDto, UpdateVocabCategoryDto } from './dto/category.dto.js';
import { BulkCreateVocabWordsDto, CreateVocabWordDto, UpdateVocabWordDto } from './dto/word.dto.js';
import { StartReviewDto, SubmitWordReviewDto } from './dto/review.dto.js';

@ApiTags('Vocab Notebook')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vocab-notebook')
export class VocabNotebookController {
  constructor(private readonly service: VocabNotebookService) {}

  // ─── Categories ──────────────────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({ summary: "List the current user's vocabulary categories" })
  listCategories(@CurrentUser() user: AuthUser) {
    return this.service.listCategories(user.userId);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a vocabulary category' })
  createCategory(@CurrentUser() user: AuthUser, @Body() dto: CreateVocabCategoryDto) {
    return this.service.createCategory(user.userId, dto);
  }

  @Put('categories/:id')
  @ApiOperation({ summary: 'Rename a vocabulary category' })
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateVocabCategoryDto,
  ) {
    return this.service.updateCategory(user.userId, id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a vocabulary category (words become uncategorized)' })
  deleteCategory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deleteCategory(user.userId, id);
  }

  // ─── Words ───────────────────────────────────────────────────────────────

  @Get('words')
  @ApiOperation({ summary: "List the current user's vocabulary words" })
  listWords(
    @CurrentUser() user: AuthUser,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listWords(user.userId, categoryId, search);
  }

  @Get('words/:id')
  @ApiOperation({ summary: 'Get a vocabulary word by id' })
  getWord(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getWord(user.userId, id);
  }

  @Post('words')
  @ApiOperation({ summary: 'Add a vocabulary word to the personal dictionary' })
  createWord(@CurrentUser() user: AuthUser, @Body() dto: CreateVocabWordDto) {
    return this.service.createWord(user.userId, dto);
  }

  @Post('words/bulk')
  @ApiOperation({ summary: 'Bulk-create vocabulary words (e.g. pasted from a spreadsheet)' })
  bulkCreateWords(@CurrentUser() user: AuthUser, @Body() dto: BulkCreateVocabWordsDto) {
    return this.service.bulkCreateWords(user.userId, dto.items);
  }

  @Put('words/:id')
  @ApiOperation({ summary: 'Edit a vocabulary word' })
  updateWord(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateVocabWordDto) {
    return this.service.updateWord(user.userId, id, dto);
  }

  @Delete('words/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a vocabulary word' })
  deleteWord(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deleteWord(user.userId, id);
  }

  // ─── Overview ────────────────────────────────────────────────────────────

  @Get('overview')
  @ApiOperation({ summary: "Summary stats for the current user's notebook" })
  getOverview(@CurrentUser() user: AuthUser) {
    return this.service.getOverview(user.userId);
  }

  // ─── Review ──────────────────────────────────────────────────────────────

  @Post('review/start')
  @ApiOperation({ summary: 'Select words for a review/practice session from the personal dictionary' })
  startReview(@CurrentUser() user: AuthUser, @Body() dto: StartReviewDto) {
    return this.service.startReview(user.userId, dto);
  }

  @Post('review/submit')
  @ApiOperation({ summary: 'Record that a word was reviewed in the current session' })
  submitWordReview(@CurrentUser() user: AuthUser, @Body() dto: SubmitWordReviewDto) {
    return this.service.submitWordReview(user.userId, dto.vocabWordId, dto.sessionId, dto.result);
  }
}
