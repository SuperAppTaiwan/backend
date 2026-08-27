import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RecurrenceService } from '../schedule/recurrence.service.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { RecurringExpenseController } from './recurring-expense.controller.js';
import { RecurringExpenseService } from './recurring-expense.service.js';
import { RecurringExpenseReminderCron } from './recurring-expense-reminder.cron.js';

@Module({
  imports: [PrismaModule, EventsModule, AuthModule, NotificationsModule],
  controllers: [FinanceController, RecurringExpenseController],
  providers: [FinanceService, RecurringExpenseService, RecurrenceService, RecurringExpenseReminderCron],
  exports: [FinanceService, RecurringExpenseService],
})
export class FinanceModule {}
