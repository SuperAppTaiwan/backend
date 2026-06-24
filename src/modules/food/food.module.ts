import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FoodService } from './food.service.js';
import { FoodController } from './food.controller.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, EventsModule, AuthModule, ConfigModule],
  controllers: [FoodController],
  providers: [FoodService],
  exports: [FoodService],
})
export class FoodModule {}
