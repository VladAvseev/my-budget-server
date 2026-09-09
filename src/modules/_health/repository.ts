import { checkDbConnection } from '@/db/pool.js';
import type { HealthCheckResult } from './types.js';

const startedAt = new Date();

export class HealthRepository {
  async check(): Promise<HealthCheckResult> {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const dbUp = await checkDbConnection();

    return {
      status: dbUp ? 'ok' : 'error',
      database: dbUp ? 'up' : 'down',
      startedAt: startedAt.toISOString(),
      uptime: Math.floor(uptime),
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      },
    };
  }
}

export const healthRepository = new HealthRepository();
