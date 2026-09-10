import { authenticate, requireAdmin } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { adminController } from './controller.js';

export const adminRouter = Router();

// Замена проверки is_admin() внутри каждой RPC-функции Supabase
// (raise exception 'Доступ запрещён'): сначала валидируем JWT, затем роль.
adminRouter.use(authenticate, requireAdmin);

// GET /admin/dashboard/stats — RPC admin_get_dashboard_stats (хук
// useAdminStats): сводная статистика — пользователи (всего/без отчётов/
// онбординг), активность DAU/WAU/MAU, отток, отчёты,
// операции по типам. Дашборд админ-панели (страница «Дашборд»).
adminRouter.get('/dashboard/stats', adminController.getStats);

// GET /admin/dashboard/operations-dynamics — RPC admin_get_operations_dynamics
// (хук useAdminOperationsDynamics): количество операций по дням
// (группировка в московском времени). График динамики на дашборде.
adminRouter.get('/dashboard/operations-dynamics', adminController.getOperationsDynamics);

// GET /admin/dashboard/database-size — RPC admin_get_database_size (хук
// useAdminDatabaseSize): размер базы данных. Карточка размера на дашборде.
adminRouter.get('/dashboard/database-size', adminController.getDatabaseSize);

// GET /admin/users — RPC admin_get_users (хук useAdminUsers): список всех
// пользователей со статистикой (email, активность, онбординг, количество
// отчётов/операций/категорий/накоплений/целей). Таблица страницы
// «Пользователи» админ-панели.
adminRouter.get('/users', adminController.listUsers);

// GET /admin/logs?status=all|success|error&page=1&limit=50 — трассировка
// HTTP-запросов из request_logs (пишет requestLoggingMiddleware). Вкладка
// «Логи» админ-панели: таблица с фильтром по успеху и пагинацией.
adminRouter.get('/logs', adminController.listLogs);

// GET /admin/logs/metrics?period=24h|7d|30d|all — агрегированные метрики
// логов (объём, errorRate, avg/p95, топы эндпоинтов, динамика). Сводный блок
// вкладки «Логи» админ-панели.
adminRouter.get('/logs/metrics', adminController.getLogsMetrics);
