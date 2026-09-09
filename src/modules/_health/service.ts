import { healthRepository } from './repository.js';

export class HealthService {
  async getStatus() {
    return healthRepository.check();
  }
}
export const healthService = new HealthService();
