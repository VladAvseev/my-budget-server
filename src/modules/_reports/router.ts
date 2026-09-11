import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { reportsController } from './controller.js';

export const reportsRouter = Router();

// Все маршруты требуют Bearer access-токен: отчёты видны только их владельцу.
reportsRouter.use(authenticate);

// GET /reports (хуки useReports): список отчётов текущего
// пользователя. Страница «Отчёты» (ReportsList), главная (LastReportCard,
// NewReportCard), выбор периодов в overview, страница накоплений
// (GrowthDynamicsCard, GoalsSection).
reportsRouter.get('/', reportsController.list);

// GET /reports/capital-dynamics (хук useCapitalDynamics): помесячная дельта
// капитала для графика на главной. Обязан стоять до /:id, иначе Express
// примет 'capital-dynamics' за id отчёта.
reportsRouter.get('/capital-dynamics', reportsController.getCapitalDynamics);

// POST /reports (хук useCreateReport): создание отчёта
// из модалки CreateReportModal на странице «Отчёты»
// (name, code периода, настройки daily-расходов, период start/end).
reportsRouter.post('/', reportsController.create);

// GET /reports/:id (хук useReport): один отчёт по id.
// Страница отчёта (page.tsx) и страница настроек отчёта (_reportSettings).
reportsRouter.get('/:id', reportsController.getById);

// PATCH /reports/:id (хук useUpdateReport): переименование
// отчёта и включение/выключение ежедневных расходов (карточки настроек отчёта:
// переименование и DailyExpensesCard).
reportsRouter.patch('/:id', reportsController.update);

// DELETE /reports/:id (хук useRemoveReport): удаление
// отчёта вместе с операциями и лимитами (карточка RemoveReportCard в настройках).
reportsRouter.delete('/:id', reportsController.remove);

// GET /reports/:id/summary (хуки useSummary): сводка
// сумм по типам операций отчёта. SummaryCards на странице отчёта и карточка
// последнего отчёта на главной (LastReportCard).
reportsRouter.get('/:id/summary', reportsController.getSummary);

// GET /reports/:id/category-limits (хук
// useCategoryLimits): лимиты расходов по категориям для отчёта.
// CategoryLimitsSummary на странице отчёта и CategoryLimitsCard в настройках.
reportsRouter.get('/:id/category-limits', reportsController.getCategoryLimits);

// PUT /reports/:id/category-limits (хук
// useSetCategoryLimits): полная замена списка лимитов (удаление + вставка
// в одной транзакции). Категория лимита должна принадлежать тому же
// пользователю — это проверяет сервис.
reportsRouter.put('/:id/category-limits', reportsController.setCategoryLimits);

// POST /reports/:id/daily-expenses (хук
// useCreateDailyExpense): добавление daily-расхода на первую свободную дату
// периода (период сервер берёт из строки отчёта). Форма операции на странице
// отчёта, ежедневная вкладка.
reportsRouter.post('/:id/daily-expenses', reportsController.createDailyExpense);

// DELETE /reports/:id/daily-expenses (хук
// useDisableDailyExpenses): отключение ежедневных расходов — удаляет все
// daily-операции отчёта и сбрасывает настройки (кнопка «Отключить»
// в DailyExpensesCard).
reportsRouter.delete('/:id/daily-expenses', reportsController.disableDailyExpenses);
