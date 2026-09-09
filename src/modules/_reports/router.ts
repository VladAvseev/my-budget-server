import { Router } from 'express';
import { reportsController } from './controller.js';

export const reportsRouter = Router();

// GET /reports — RPC get_reports (хуки useReports): список отчётов текущего
// пользователя. Страница «Отчёты» (ReportsList), главная (LastReportCard,
// NewReportCard), выбор периодов в overview, страница накоплений
// (GrowthDynamicsCard, GoalsSection).
reportsRouter.get('/', reportsController.list);

// POST /reports — RPC create_report (хук useCreateReport): создание отчёта
// из модалки CreateReportModal на странице «Отчёты»
// (name, code периода, настройки daily-расходов, период start/end).
reportsRouter.post('/', reportsController.create);

// GET /reports/:id — RPC get_report (хук useReport): один отчёт по id.
// Страница отчёта (page.tsx) и страница настроек отчёта (_reportSettings).
reportsRouter.get('/:id', reportsController.getById);

// PATCH /reports/:id — RPC update_report (хук useUpdateReport): переименование
// отчёта и включение/выключение ежедневных расходов (карточки настроек отчёта:
// переименование и DailyExpensesCard).
reportsRouter.patch('/:id', reportsController.update);

// DELETE /reports/:id — RPC delete_report (хук useRemoveReport): удаление
// отчёта вместе с операциями и лимитами (карточка RemoveReportCard в настройках).
reportsRouter.delete('/:id', reportsController.remove);

// GET /reports/:id/summary — RPC get_report_summary (хуки useSummary): сводка
// сумм по типам операций отчёта. SummaryCards на странице отчёта и карточка
// последнего отчёта на главной (LastReportCard).
reportsRouter.get('/:id/summary', reportsController.getSummary);

// GET /reports/:id/category-limits — RPC get_category_limits (хук
// useCategoryLimits): лимиты расходов по категориям для отчёта.
// CategoryLimitsSummary на странице отчёта и CategoryLimitsCard в настройках.
reportsRouter.get('/:id/category-limits', reportsController.getCategoryLimits);

// PUT /reports/:id/category-limits — RPC set_category_limits (хук
// useSetCategoryLimits): полная замена списка лимитов (удаление + вставка).
// Категория лимита должна принадлежать тому же пользователю (проверяется в БД).
reportsRouter.put('/:id/category-limits', reportsController.setCategoryLimits);

// POST /reports/:id/daily-expenses — RPC create_daily_expense (хук
// useCreateDailyExpense): добавление daily-расхода на первую свободную дату
// периода отчёта. Форма операции на странице отчёта, ежедневная вкладка.
reportsRouter.post('/:id/daily-expenses', reportsController.createDailyExpense);

// DELETE /reports/:id/daily-expenses — RPC disable_daily_expenses (хук
// useDisableDailyExpenses): отключение ежедневных расходов — удаляет все
// daily-операции отчёта и сбрасывает настройки (кнопка «Отключить»
// в DailyExpensesCard).
reportsRouter.delete('/:id/daily-expenses', reportsController.disableDailyExpenses);
