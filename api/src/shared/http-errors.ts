export type AppErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: AppErrorDetails;

  constructor(code: string, message: string, statusCode: number, details?: AppErrorDetails) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: AppErrorDetails): AppError {
    return new AppError(code, message, 400, details);
  }

  static unauthorized(message = 'No autenticado', code = 'UNAUTHORIZED'): AppError {
    return new AppError(code, message, 401);
  }

  static forbidden(message = 'Sin permisos', code = 'FORBIDDEN'): AppError {
    return new AppError(code, message, 403);
  }

  static notFound(message = 'Recurso no encontrado', code = 'NOT_FOUND'): AppError {
    return new AppError(code, message, 404);
  }

  static conflict(message: string, code = 'CONFLICT', details?: AppErrorDetails): AppError {
    return new AppError(code, message, 409, details);
  }
}
