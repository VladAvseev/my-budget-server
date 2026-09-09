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

// DELETE /admin/users/:id — безвозвратное удаление аккаунта со всей
// статистикой (on delete cascade в db/schema.sql снимает связанные строки;
// refresh_tokens пользователя отзываются тем же каскадом).
// Сервис не позволяет удалить собственный аккаунт (400).
adminRouter.delete('/users/:id', adminController.removeUser);
