import { authenticate, requireAdmin } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { adminController } from './controller.js';

export const adminRouter = Router();

// Доступ к админке — только с ролью admin: сначала валидируем JWT, затем роль.
adminRouter.use(authenticate, requireAdmin);

// GET /admin/dashboard/stats (хук useAdminStats): сводная статистика —
// пользователи (всего/без отчётов/
// онбординг), активность DAU/WAU/MAU, отток, отчёты,
// операции по типам. Дашборд админ-панели (страница «Дашборд»).
adminRouter.get('/dashboard/stats', adminController.getStats);

// GET /admin/dashboard/operations-dynamics?audience=all|users&metric=count|unique_users&aggregation=D|M|Y
// (хук useAdminOperationsDynamics):
// динамика операций по МСК-периодам. Аудитория users — только операции
// пользователей с ролью 'user' (без админов). Метрика unique_users считает
// count(distinct user_id) на выбранной гранулярности. График динамики на
// дашборде.
adminRouter.get('/dashboard/operations-dynamics', adminController.getOperationsDynamics);

// GET /admin/dashboard/database-size (хук useAdminDatabaseSize):
// размер базы данных. Карточка размера на дашборде.
adminRouter.get('/dashboard/database-size', adminController.getDatabaseSize);

// GET /admin/dashboard/storage-breakdown — общий размер БД + разбивка по
// таблицам схемы public (pg_total_relation_size, по убыванию веса). Карточка
// «Хранилище» на дашборде.
adminRouter.get('/dashboard/storage-breakdown', adminController.getStorageBreakdown);

// GET /admin/users (хук useAdminUsers): список всех
// пользователей со статистикой (email, активность, онбординг, количество
// отчётов/операций/категорий/накоплений/целей). Таблица страницы
// «Пользователи» админ-панели.
adminRouter.get('/users', adminController.listUsers);

// DELETE /admin/users/:userId — физическое удаление пользователя (данные
// снимаются каскадом БД). Кнопка «Удалить» в таблице страницы «Пользователи»
// с подтверждением вводом email. Удалить себя сервер не даёт (400).
adminRouter.delete('/users/:userId', adminController.deleteUser);

// GET /admin/logs?status=all|success|error&userId=<uuid>|anonymous&methods=GET,POST
//     &page=1&limit=50&sort=date|duration&order=asc|desc —
// трассировка HTTP-запросов из request_logs (пишет requestLoggingMiddleware).
// Вкладка «Логи» админ-панели: таблица с фильтром по успеху, автору запроса
// (userId=anonymous — только запросы без авторизации) и HTTP-методам (пусто —
// все), сортировкой по дате или длительности и пагинацией.
adminRouter.get('/logs', adminController.listLogs);

// GET /admin/logs/metrics?period=24h|7d|30d|all — агрегированные метрики
// логов (объём, errorRate, avg/p95, топы эндпоинтов, динамика). Сводный блок
// вкладки «Логи» админ-панели.
adminRouter.get('/logs/metrics', adminController.getLogsMetrics);

// GET /admin/logs/dynamics?audience=all|users&metric=count|unique_users&bucket=hour|day —
// динамика логов по МСК-часам/суткам. Отдельная карточка-график «Логи»
// на вкладке «Логи»: фильтр «Все/Пользователи» по роли автора (user_role) и
// метрика «Количество/Уникальные» (count(distinct user_id) на выбранном бакете).
adminRouter.get('/logs/dynamics', adminController.getLogsDynamics);
