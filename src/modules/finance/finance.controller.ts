import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { FinanceService } from './finance.service.js';
import { CreateIncomeSourceDto } from './dto/create-income-source.dto.js';
import { UpdateIncomeSourceDto } from './dto/update-income-source.dto.js';
import { CreateIncomeDto } from './dto/create-income.dto.js';
import { UpdateIncomeDto } from './dto/update-income.dto.js';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto.js';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { UpdateExpenseDto } from './dto/update-expense.dto.js';
import { CreateBudgetDto } from './dto/create-budget.dto.js';
import { UpdateBudgetDto } from './dto/update-budget.dto.js';
import { MonthYearQueryDto, TrendQueryDto } from './dto/report-query.dto.js';

@ApiTags('Finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // ─── Income Sources ──────────────────────────────────────────────────────────

  @Post('income-sources')
  @ApiOperation({ summary: 'Create income source' })
  @ApiResponse({ status: 201, description: 'Income source created' })
  createIncomeSource(@CurrentUser() user: AuthUser, @Body() dto: CreateIncomeSourceDto) {
    return this.financeService.createIncomeSource(user.userId, dto);
  }

  @Get('income-sources')
  @ApiOperation({ summary: 'List all income sources' })
  findAllIncomeSources(@CurrentUser() user: AuthUser) {
    return this.financeService.findAllIncomeSources(user.userId);
  }

  @Get('income-sources/:id')
  @ApiOperation({ summary: 'Get income source by ID' })
  findOneIncomeSource(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.financeService.findOneIncomeSource(user.userId, id);
  }

  @Put('income-sources/:id')
  @ApiOperation({ summary: 'Update income source' })
  updateIncomeSource(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateIncomeSourceDto,
  ) {
    return this.financeService.updateIncomeSource(user.userId, id, dto);
  }

  @Delete('income-sources/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete income source' })
  removeIncomeSource(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.financeService.removeIncomeSource(user.userId, id);
  }

  // ─── Incomes ─────────────────────────────────────────────────────────────────

  @Post('incomes')
  @ApiOperation({ summary: 'Record income' })
  @ApiResponse({ status: 201, description: 'Income recorded' })
  createIncome(@CurrentUser() user: AuthUser, @Body() dto: CreateIncomeDto) {
    return this.financeService.createIncome(user.userId, dto);
  }

  @Get('incomes')
  @ApiOperation({ summary: 'List all incomes' })
  findAllIncomes(@CurrentUser() user: AuthUser) {
    return this.financeService.findAllIncomes(user.userId);
  }

  @Get('incomes/:id')
  @ApiOperation({ summary: 'Get income by ID' })
  findOneIncome(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.financeService.findOneIncome(user.userId, id);
  }

  @Put('incomes/:id')
  @ApiOperation({ summary: 'Update income' })
  updateIncome(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateIncomeDto,
  ) {
    return this.financeService.updateIncome(user.userId, id, dto);
  }

  @Delete('incomes/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete income' })
  removeIncome(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.financeService.removeIncome(user.userId, id);
  }

  // ─── Expense Categories ──────────────────────────────────────────────────────

  @Post('expense-categories')
  @ApiOperation({ summary: 'Create expense category' })
  @ApiResponse({ status: 201, description: 'Category created' })
  createExpenseCategory(@CurrentUser() user: AuthUser, @Body() dto: CreateExpenseCategoryDto) {
    return this.financeService.createExpenseCategory(user.userId, dto);
  }

  @Get('expense-categories')
  @ApiOperation({ summary: 'List expense categories (own + defaults)' })
  findAllExpenseCategories(@CurrentUser() user: AuthUser) {
    return this.financeService.findAllExpenseCategories(user.userId);
  }

  @Put('expense-categories/:id')
  @ApiOperation({ summary: 'Update expense category' })
  updateExpenseCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.financeService.updateExpenseCategory(user.userId, id, dto);
  }

  @Delete('expense-categories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete expense category' })
  removeExpenseCategory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.financeService.removeExpenseCategory(user.userId, id);
  }

  // ─── Expenses ────────────────────────────────────────────────────────────────

  @Post('expenses')
  @ApiOperation({ summary: 'Record expense' })
  @ApiResponse({ status: 201, description: 'Expense recorded' })
  createExpense(@CurrentUser() user: AuthUser, @Body() dto: CreateExpenseDto) {
    return this.financeService.createExpense(user.userId, dto);
  }

  @Get('expenses')
  @ApiOperation({ summary: 'List all expenses' })
  findAllExpenses(@CurrentUser() user: AuthUser) {
    return this.financeService.findAllExpenses(user.userId);
  }

  @Get('expenses/:id')
  @ApiOperation({ summary: 'Get expense by ID' })
  findOneExpense(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.financeService.findOneExpense(user.userId, id);
  }

  @Put('expenses/:id')
  @ApiOperation({ summary: 'Update expense' })
  updateExpense(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.financeService.updateExpense(user.userId, id, dto);
  }

  @Delete('expenses/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete expense' })
  removeExpense(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.financeService.removeExpense(user.userId, id);
  }

  // ─── Budgets ─────────────────────────────────────────────────────────────────

  @Post('budgets')
  @ApiOperation({ summary: 'Set monthly budget' })
  @ApiResponse({ status: 201, description: 'Budget created' })
  createBudget(@CurrentUser() user: AuthUser, @Body() dto: CreateBudgetDto) {
    return this.financeService.createBudget(user.userId, dto);
  }

  @Get('budgets')
  @ApiOperation({ summary: 'List all budgets' })
  findAllBudgets(@CurrentUser() user: AuthUser) {
    return this.financeService.findAllBudgets(user.userId);
  }

  @Get('budgets/current')
  @ApiOperation({ summary: 'Get current month budget' })
  findCurrentBudget(@CurrentUser() user: AuthUser) {
    return this.financeService.findCurrentBudget(user.userId);
  }

  @Put('budgets/:id')
  @ApiOperation({ summary: 'Update budget' })
  updateBudget(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.financeService.updateBudget(user.userId, id, dto);
  }

  @Delete('budgets/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete budget' })
  removeBudget(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.financeService.removeBudget(user.userId, id);
  }

  // ─── Reports ─────────────────────────────────────────────────────────────────

  @Get('monthly-report')
  @ApiOperation({ summary: 'Monthly income/expense report' })
  getMonthlyReport(@CurrentUser() user: AuthUser, @Query() query: MonthYearQueryDto) {
    return this.financeService.getMonthlyReport(user.userId, query.month, query.year);
  }

  @Get('budget-status')
  @ApiOperation({ summary: 'Budget status for a given month' })
  getBudgetStatus(@CurrentUser() user: AuthUser, @Query() query: MonthYearQueryDto) {
    return this.financeService.getBudgetStatus(user.userId, query.month, query.year);
  }

  @Get('cashflow-forecast')
  @ApiOperation({ summary: 'Cashflow forecast based on past 3 months' })
  getCashflowForecast(@CurrentUser() user: AuthUser) {
    return this.financeService.getCashflowForecast(user.userId);
  }

  @Get('monthly-trend')
  @ApiOperation({ summary: 'Income/expense/savings series for the trailing N months (chart data)' })
  getMonthlyTrend(@CurrentUser() user: AuthUser, @Query() query: TrendQueryDto) {
    return this.financeService.getMonthlyTrend(user.userId, query.months ?? 6);
  }
}
