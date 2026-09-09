import { Router } from 'express';
import { categoriesController } from './controller.js';

export const categoriesRouter = Router();

// GET /categories?type={income|expense|savings} — RPC get_categories (хуки
// useCategories/useOverviewCategories): категории текущего пользователя,
// опционально по типу. Секция категорий в профиле (CategorySection), выбор
// категории в форме операции и OperationList на странице отчёта, разбивка
// и распределение по категориям в overview, цели/накопления, карточка
// накоплений на главной.
categoriesRouter.get('/', categoriesController.list);

// POST /categories — RPC create_category (хук useCreateCategory): создание
// категории из модалки AddCategoryModal в профиле (тип, название, цвет).
categoriesRouter.post('/', categoriesController.create);

// PATCH /categories/:id — RPC update_category (хук useUpdateCategory):
// переименование и смена цвета категории из модалки EditCategoryModal.
categoriesRouter.patch('/:id', categoriesController.update);

// DELETE /categories/:id — RPC delete_category (хук useRemoveCategory):
// удаление категории по кнопке в CategorySection профиля.
categoriesRouter.delete('/:id', categoriesController.remove);
