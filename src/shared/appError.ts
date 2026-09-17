export class AppError extends Error {
  status: number;

  code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
