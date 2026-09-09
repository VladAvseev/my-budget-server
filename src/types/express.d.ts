/**
 * Расширение типов Express: после прохождения authMiddleware
 * к запросу добавляется поле `user` — данные из проверенного access-токена.
 * Файл подключается к компиляции автоматически (d.ts в src/, см. tsconfig).
 */
declare global {
  namespace Express {
    interface Request {
      /** Заполняется только в маршрутах за `authenticate`. */
      user?: {
        /** id пользователя (uuid из таблицы users) — JWT-claim `sub`. */
        id: string;
        /** 'user' | 'admin' — JWT-claim `role`. */
        role: string;
      };
    }
  }
}

export {};
