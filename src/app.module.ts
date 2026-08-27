import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// Aliased: this project's own Schedule *feature* module (below) is unrelated to and would
// otherwise collide in name with @nestjs/schedule's cron-trigger ScheduleModule.
import { ScheduleModule as CronModule } from '@nestjs/schedule';
import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ProfileModule } from './modules/profile/profile.module.js';
import { FinanceModule } from './modules/finance/finance.module.js';
import { GoalsModule } from './modules/goals/goals.module.js';
import { LearningModule } from './modules/learning/learning.module.js';
import { VocabNotebookModule } from './modules/vocab-notebook/vocab-notebook.module.js';
import { ScheduleModule } from './modules/schedule/schedule.module.js';
import { AIModule } from './modules/ai/ai.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { FoodModule } from './modules/food/food.module.js';
import { KnowledgeModule } from './modules/knowledge/knowledge.module.js';
import { ChineseStoryModule } from './modules/chinese-story/chinese-story.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    CronModule.forRoot(),
    PrismaModule,
    HealthModule,
    EventsModule,
    AuthModule,
    ProfileModule,
    FinanceModule,
    GoalsModule,
    LearningModule,
    VocabNotebookModule,
    ScheduleModule,
    AIModule,
    NotificationsModule,
    FoodModule,
    KnowledgeModule,
    ChineseStoryModule,
  ],
})
export class AppModule {}
