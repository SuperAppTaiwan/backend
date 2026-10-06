import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { WritingNotebookService } from './writing-notebook.service.js';
import {
  CreateWritingNotebookDto,
  CreateWritingPageDto,
  UpdateWritingNotebookDto,
  UpdateWritingPageDto,
} from './dto/writing-notebook.dto.js';

@ApiTags('Chinese Learning — Writing Notebook')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chinese-learning/writing-notebooks')
export class WritingNotebookController {
  constructor(private readonly service: WritingNotebookService) {}

  // ─── Notebooks ───────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: "List the current user's writing notebooks" })
  listNotebooks(@CurrentUser() user: AuthUser) {
    return this.service.listNotebooks(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a writing notebook' })
  createNotebook(@CurrentUser() user: AuthUser, @Body() dto: CreateWritingNotebookDto) {
    return this.service.createNotebook(user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a writing notebook' })
  updateNotebook(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateWritingNotebookDto) {
    return this.service.updateNotebook(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a writing notebook and all of its pages' })
  deleteNotebook(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deleteNotebook(user.userId, id);
  }

  // ─── Pages ───────────────────────────────────────────────────────────────

  @Get(':id/pages')
  @ApiOperation({ summary: 'List pages (paginated, without stroke data)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor from the previous response' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (default 20, max 50)' })
  listPages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listPages(user.userId, id, cursor, limit);
  }

  @Post(':id/pages')
  @ApiOperation({ summary: 'Add a page (BLANK or GUIDED template)' })
  createPage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateWritingPageDto) {
    return this.service.createPage(user.userId, id, dto);
  }

  @Get(':id/pages/:pageId')
  @ApiOperation({ summary: 'Get a page with its full stroke data' })
  getPage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('pageId') pageId: string) {
    return this.service.getPage(user.userId, id, pageId);
  }

  @Put(':id/pages/:pageId')
  @ApiOperation({ summary: 'Replace the page stroke set (409 if `version` is stale)' })
  updatePage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('pageId') pageId: string,
    @Body() dto: UpdateWritingPageDto,
  ) {
    return this.service.updatePage(user.userId, id, pageId, dto);
  }

  @Delete(':id/pages/:pageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a page' })
  deletePage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('pageId') pageId: string) {
    return this.service.deletePage(user.userId, id, pageId);
  }
}
