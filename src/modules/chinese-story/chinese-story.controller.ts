import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { ChineseStoryService } from './chinese-story.service.js';
import { SaveStoryDto } from './dto/story.dto.js';

@ApiTags('Chinese Story')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chinese-story')
export class ChineseStoryController {
  constructor(private readonly service: ChineseStoryService) {}

  @Get('stories')
  @ApiOperation({ summary: "List the current user's saved AI stories" })
  listStories(@CurrentUser() user: AuthUser) {
    return this.service.listStories(user.userId);
  }

  @Get('stories/:id')
  @ApiOperation({ summary: 'Get a saved story by id' })
  getStory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getStory(user.userId, id);
  }

  @Post('generate')
  @ApiOperation({ summary: "Generate a story preview from the user's vocabulary (not persisted until saved)" })
  generatePreview(@CurrentUser() user: AuthUser) {
    return this.service.generatePreview(user.userId);
  }

  @Post('stories')
  @ApiOperation({ summary: 'Save an accepted story preview to the personal story library' })
  saveStory(@CurrentUser() user: AuthUser, @Body() dto: SaveStoryDto) {
    return this.service.saveStory(user.userId, dto);
  }

  @Delete('stories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a saved story' })
  deleteStory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.deleteStory(user.userId, id);
  }
}
