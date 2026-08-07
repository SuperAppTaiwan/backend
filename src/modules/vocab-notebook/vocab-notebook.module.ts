import { Module } from '@nestjs/common';
import { VocabNotebookController } from './vocab-notebook.controller.js';
import { VocabNotebookService } from './vocab-notebook.service.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, EventsModule, AuthModule],
  controllers: [VocabNotebookController],
  providers: [VocabNotebookService],
  exports: [VocabNotebookService],
})
export class VocabNotebookModule {}
