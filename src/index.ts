import { closePool } from '@/db/pool.js';
import { app } from '@/app.js';
import 'dotenv/config';
import type { Server } from 'node:http';

const port = process.env.PORT || 5001;

const server: Server = app.listen(port, () => {
  process.stdout.write(`Server running on http://localhost:${port}\n`);
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`Получен ${signal}, остановка сервера...\n`);

  // Не даём зависнуть навсегда: жёсткий выход через 10 секунд.
  const forceExit = setTimeout(() => {
    process.stderr.write('Graceful shutdown не завершился, принудительный выход\n');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    server.close();
    await closePool();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Ошибка при остановке сервера: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
