// Саммари целей для bootstrap главной.
// Формулы — дословный порт клиентских расчётов блока «Общий прогресс»
// (client/src/modules/_capital/utils/goals.ts,
// client/src/modules/_capital/utils/buildCapitalChartData.ts,
// client/src/shared/widgets/GrowthDynamicsCard/model/buildGrowthStats.ts
// + trim-утилиты client/src/shared/utils/chartPoints.ts),
// чтобы цифры карточки «Цели» на главной совпадали с /capital.
// При правке клиентских формул синхронно обновляйте этот файл.
import type { AccountDto } from '@/modules/_accounts/types.js';
import type { GoalDto } from '@/modules/_goals/types.js';
import type { CapitalMonthDto, OperationDto } from '@/modules/_operations/types.js';
import type { GoalsSummary } from './types.js';

const RECENT_WINDOW_MONTHS = 12;

interface GoalProgress {
  goal: GoalDto;
  savedAmount: number;
  percent: number;
  reached: boolean;
  overdue: boolean;
}

interface ChartPoint {
  month: Date;
  value: number;
}

const percentOf = (saved: number, target: number): number =>
  Math.min(100, Math.max(0, Math.round((saved / target) * 100)));

const toISODate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildGoalsProgress = (goals: GoalDto[], accounts: AccountDto[], now: Date): GoalProgress[] => {
  const active = new Map(
    accounts.filter((account) => !account.is_closed).map((account) => [account.id, account]),
  );
  return goals.flatMap((goal) => {
    const account = active.get(goal.account_id);
    if (!account) return [];
    const reached = account.balance >= goal.amount;
    return [
      {
        goal,
        savedAmount: account.balance,
        percent: percentOf(account.balance, goal.amount),
        reached,
        overdue: goal.target_date !== null && goal.target_date < toISODate(now) && !reached,
      },
    ];
  });
};

const buildGoalsOverallProgress = (progress: GoalProgress[]) => {
  const totalSaved = progress.reduce(
    (sum, item) => sum + Math.max(0, Math.min(item.savedAmount, item.goal.amount)),
    0,
  );
  const totalTarget = progress.reduce((sum, item) => sum + item.goal.amount, 0);
  return {
    totalSaved,
    totalTarget,
    percent: totalTarget > 0 ? percentOf(totalSaved, totalTarget) : 0,
  };
};

const buildGoalForecast = (goal: GoalDto, savedAmount: number, now: Date) => {
  const remaining = Math.max(0, goal.amount - savedAmount);
  const targetDate = goal.target_date ? new Date(`${goal.target_date}T00:00:00`) : null;
  let monthsLeft: number | null = null;
  if (remaining > 0 && targetDate && targetDate > now) {
    monthsLeft = Math.max(
      1,
      (targetDate.getFullYear() - now.getFullYear()) * 12 +
        targetDate.getMonth() -
        now.getMonth() +
        (targetDate.getDate() > 1 ? 1 : 0),
    );
  }
  return {
    targetDate: goal.target_date,
    monthsLeft,
    requiredMonthly: monthsLeft === null ? null : remaining / monthsLeft,
  };
};

const forecastAchievement = (remaining: number, avg: number | null, now: Date) => {
  if (remaining <= 0 || avg === null || avg <= 0) return null;
  const months = Math.ceil(remaining / avg);
  const date = new Date(now.getFullYear(), now.getMonth() + months, 1);
  if (!Number.isFinite(months) || Number.isNaN(date.getTime()) || date.getFullYear() > 9999)
    return null;
  return { months, date: toISODate(date) };
};

const goalMonthlyContribution = (
  progress: GoalProgress,
  overallMonths: number | null,
  now: Date,
): number => {
  if (progress.reached) return 0;
  const required = buildGoalForecast(progress.goal, progress.savedAmount, now).requiredMonthly;
  if (required !== null) return Math.ceil(required);
  return overallMonths === null
    ? 0
    : Math.ceil(Math.max(0, progress.goal.amount - progress.savedAmount) / overallMonths);
};

const currentGoalContributions = (
  operations: OperationDto[],
  accountIds: ReadonlySet<string>,
): number =>
  operations.reduce((sum, op) => {
    if (op.type === 'transfer') {
      return (
        sum +
        (op.to_account_id && accountIds.has(op.to_account_id) ? op.amount : 0) -
        (op.from_account_id && accountIds.has(op.from_account_id) ? op.amount : 0)
      );
    }
    if (!op.account_id || !accountIds.has(op.account_id)) return sum;
    return sum + (op.type === 'income' ? op.amount : -op.amount);
  }, 0);

const parseMonth = (month: string): Date | null => {
  const [year, m] = month.split('-').map(Number);
  if (!year || !m || m < 1 || m > 12) return null;
  return new Date(year, m - 1, 1);
};

const buildCapitalChartData = (months: CapitalMonthDto[], base: number, now: Date): ChartPoint[] => {
  const lastMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const deltas = new Map<number, number>();
  for (const entry of months) {
    const cursor = parseMonth(entry.month);
    if (!cursor || cursor > lastMonth || !Number.isFinite(entry.delta)) continue;
    const key = cursor.getTime();
    deltas.set(key, (deltas.get(key) ?? 0) + entry.delta);
  }
  if (deltas.size === 0) return [];
  let cursor = new Date(Math.min(...deltas.keys()));
  const points: ChartPoint[] = [];
  let cumulativeValue = 0;
  while (cursor <= lastMonth) {
    cumulativeValue += deltas.get(cursor.getTime()) ?? 0;
    points.push({ month: new Date(cursor), value: base + cumulativeValue });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return points;
};

const trimIncompletePeriod = (points: ChartPoint[], now: Date): ChartPoint[] => {
  if (points.length === 0) return points;
  const last = points[points.length - 1];
  const periodEnd = new Date(last.month.getFullYear(), last.month.getMonth() + 1, 1);
  return now < periodEnd ? points.slice(0, -1) : points;
};

const trimLeadingPartialPeriod = (
  points: ChartPoint[],
  firstActivityDate: Date | null,
): ChartPoint[] => {
  if (points.length === 0) return points;
  if (firstActivityDate) {
    const first = points[0];
    const periodStart = new Date(first.month.getFullYear(), first.month.getMonth(), 1);
    const activityDay = new Date(
      firstActivityDate.getFullYear(),
      firstActivityDate.getMonth(),
      firstActivityDate.getDate(),
    );
    if (activityDay > periodStart) return points.slice(1);
  }
  return points;
};

const buildRecentMonthlyGrowth = (
  data: ChartPoint[],
  base: number,
  firstActivityDate: Date | null,
  now: Date,
): { avg: number | null; months: number } => {
  const completed = trimLeadingPartialPeriod(
    trimIncompletePeriod(data, now),
    firstActivityDate,
  ).slice(-RECENT_WINDOW_MONTHS);
  if (!completed.length) return { avg: null, months: 0 };
  const firstIndex = data.indexOf(completed[0]);
  const previous = firstIndex > 0 ? data[firstIndex - 1].value : base;
  return {
    avg: (completed[completed.length - 1].value - previous) / completed.length,
    months: completed.length,
  };
};

export const emptyGoalsSummary = (): GoalsSummary => ({
  hasGoals: false,
  totalSaved: 0,
  totalTarget: 0,
  percent: 0,
  monthlyPlan: 0,
  currentPeriodSaved: 0,
  growthAvg: null,
  growthMonths: 0,
  forecastMonths: null,
  forecastDate: null,
});

export interface GoalsSummaryInput {
  goals: GoalDto[];
  accounts: AccountDto[];
  operations: OperationDto[];
  dynamics: CapitalMonthDto[];
  firstActivityDate: Date | null;
  now?: Date;
}

export const buildBootstrapGoalsSummary = (input: GoalsSummaryInput): GoalsSummary => {
  const now = input.now ?? new Date();
  const progress = buildGoalsProgress(input.goals, input.accounts, now);
  if (progress.length === 0) return emptyGoalsSummary();
  const overall = buildGoalsOverallProgress(progress);
  const remaining = Math.max(0, overall.totalTarget - overall.totalSaved);
  const base = input.accounts.reduce((sum, account) => sum + account.initial_balance, 0);
  const growth = buildRecentMonthlyGrowth(
    buildCapitalChartData(input.dynamics, base, now),
    base,
    input.firstActivityDate,
    now,
  );
  const forecast = forecastAchievement(remaining, growth.avg, now);
  const forecastMonths = forecast?.months ?? null;
  const monthlyPlan = progress.reduce(
    (sum, item) => sum + goalMonthlyContribution(item, forecastMonths, now),
    0,
  );
  const currentPeriodSaved = currentGoalContributions(
    input.operations,
    new Set(progress.map((item) => item.goal.account_id)),
  );
  return {
    hasGoals: true,
    totalSaved: overall.totalSaved,
    totalTarget: overall.totalTarget,
    percent: overall.percent,
    monthlyPlan,
    currentPeriodSaved,
    growthAvg: growth.avg,
    growthMonths: growth.months,
    forecastMonths,
    forecastDate: forecast?.date ?? null,
  };
};
