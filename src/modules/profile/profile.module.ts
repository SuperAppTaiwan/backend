import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';
import { UserHealthContextService } from './user-health-context.service.js';

@Module({
  imports: [PrismaModule, EventsModule, AuthModule],
  controllers: [ProfileController],
  providers: [ProfileService, UserHealthContextService],
  exports: [ProfileService, UserHealthContextService],
})
export class ProfileModule {}
