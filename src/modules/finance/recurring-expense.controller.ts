import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { RecurringExpenseService } from './recurring-expense.service.js';
import { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto.js';
import { UpdateRecurringExpenseDto } from './dto/update-recurring-expense.dto.js';
import { MarkRecurringExpensePaidDto } from './dto/mark-recurring-expense-paid.dto.js';
import { RecurringExpenseForecastQueryDto } from './dto/recurring-expense-forecast-query.dto.js';

// Mounted under the existing `finance` route namespace (/api/v1/finance/recurring-expenses)
// rather than as its own top-level module, per the "extend the existing Finance module, don't
// build a disconnected feature" requirement. `forecast` is declared before the `:id` route so
// Nest's route matching doesn't treat "forecast" as an :id lookup.
@ApiTags('Finance - Recurring Expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('finance/recurring-expenses')
export class RecurringExpenseController {
  constructor(private readonly service: RecurringExpenseService) {}

  @Post()
  @ApiOperation({ summary: 'Create a recurring expense (weekly/monthly/yearly)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRecurringExpenseDto) {
    return this.service.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List recurring expenses (active by default)' })
  findAll(@CurrentUser() user: AuthUser, @Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(user.userId, includeInactive === 'true');
  }

  @Get('forecast')
  @ApiOperation({ summary: 'Upcoming recurring-expense forecast — shared by Home and Finance dashboards' })
  getForecast(@CurrentUser() user: AuthUser, @Query() query: RecurringExpenseForecastQueryDto) {
    return this.service.getForecast(user.userId, query.days ?? 30);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get recurring expense detail + payment history' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update recurring expense' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRecurringExpenseDto) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete recurring expense (payment history is preserved)' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.userId, id);
  }

  @Post(':id/pay')
  @ApiOperation({ summary: 'Mark an occurrence as paid (before, on, or after its due date)' })
  markPaid(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MarkRecurringExpensePaidDto) {
    return this.service.markPaid(user.userId, id, dto);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Payment history for one recurring expense' })
  getHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getHistory(user.userId, id);
  }
}
