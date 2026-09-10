import { authenticate } from '@/middlewares/authMiddleware.js';
import { Router } from 'express';
import { categoriesController } from './controller.js';

export const categoriesRouter = Router();

// Все маршруты требуют Bearer access-токен: категории видны только их владельцу.
categoriesRouter.use(authenticate);

// GET /categories?type={income|expense|savings} (хуки useCategories/
// useOverviewCategories): категории текущего пользователя,
// опционально по типу. Секция категорий в профиле (CategorySection), выбор
// категории в форме операции и OperationList на странице отчёта, разбивка
// и распределение по категориям в overview, цели/накопления, карточка
// накоплений на главной.
categoriesRouter.get('/', categoriesController.list);

// POST /categories (хук useCreateCategory): создание
// категории из модалки AddCategoryModal в профиле (тип, название, цвет).
categoriesRouter.post('/', categoriesController.create);

// PATCH /categories/:id (хук useUpdateCategory):
// переименование и смена цвета категории из модалки EditCategoryModal.
categoriesRouter.patch('/:id', categoriesController.update);

// DELETE /categories/:id (хук useRemoveCategory):
// удаление категории по кнопке в CategorySection профиля.
categoriesRouter.delete('/:id', categoriesController.remove);
