import { categoriesService } from './service.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * HTTP-слой категорий. Все маршруты закрыты `authenticate` в router.ts,
 * поэтому `req.user.id` (замена auth.uid() из RPC) здесь гарантированно есть.
 * Ответы — в обёртке `{ data }`, зеркало jsonb-ответов RPC Supabase.
 */
export class CategoriesController {
  /** GET /categories?type={income|expense|savings} → 200: CategoryDto[]. */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      // express по умолчанию отдаёт '' для «?type=» — считаем это «без фильтра».
      const type =
        typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined;
      const categories = await categoriesService.list(req.user!.id, type);
      res.status(200).json({ data: categories });
    } catch (error) {
      next(error);
    }
  }

  /** POST /categories — body: { type, name, color? } → 201 + Location. */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const category = await categoriesService.create(req.user!.id, req.body ?? {});
      res.status(201).location(`${req.originalUrl}/${category.id}`).json({ data: category });
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /categories/:id — body: { name?, color? } → 200: обновлённая категория. */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const category = await categoriesService.update(req.user!.id, req.params.id, req.body ?? {});
      res.status(200).json({ data: category });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /categories/:id → 204, 404 если категории нет или она чужая. */
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await categoriesService.remove(req.user!.id, req.params.id);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}

export const categoriesController = new CategoriesController();
