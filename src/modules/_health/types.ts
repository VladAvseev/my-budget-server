export interface HealthCheckResult {
  status: 'ok' | 'error';
  database: 'up' | 'down';
  startedAt: string;
  uptime: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
}
