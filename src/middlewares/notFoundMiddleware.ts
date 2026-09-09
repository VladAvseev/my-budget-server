import type { Request, Response } from 'express';

export function notFoundMiddleware(req: Request, res: Response) {
  res.status(404).json({ error: { message: 'Маршрут не найден', status: 404 } });
}
