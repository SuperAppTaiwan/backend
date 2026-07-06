import { Module } from '@nestjs/common';
import { FoodService } from './food.service.js';
import { FoodController } from './food.controller.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AIModule } from '../ai/ai.module.js';

@Module({
  imports: [PrismaModule, EventsModule, AuthModule, AIModule],
  controllers: [FoodController],
  providers: [FoodService],
  exports: [FoodService],
})
export class FoodModule {}
