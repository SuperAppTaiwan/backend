import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WritingNotebookController } from './writing-notebook.controller.js';
import { WritingNotebookService } from './writing-notebook.service.js';

// Chinese Learning features served under /api/v1/chinese-learning/*. The
// personal vocabulary notebook still lives in ../vocab-notebook and the legacy
// shared flashcard deck in ../learning — both untouched.
@Module({
  imports: [PrismaModule, EventsModule, AuthModule],
  controllers: [WritingNotebookController],
  providers: [WritingNotebookService],
})
export class ChineseLearningModule {}
