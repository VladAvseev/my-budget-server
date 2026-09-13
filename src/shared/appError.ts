export class AppError extends Error {
  status: number;
  /**
   * Машинночитаемый код ожидаемой ошибки бизнес-логики (например,
   * 'CONSENT_REQUIRED'): клиент по нему реагирует программно, не разбирая
   * русский текст. Поле факультативное — старые клиенты его игнорируют.
   */
  code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
