import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es requerida'),
  DATABASE_URL_TEST: z.string().min(1).optional(),
  // Solo el access token es un JWT firmado. El refresh token son 48 bytes
  // aleatorios hasheados con SHA-256 en la tabla `RefreshToken` (ver ADR-004),
  // así que no existe ningún `JWT_REFRESH_SECRET`.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET debe tener al menos 32 caracteres'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENABLE_SWAGGER: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Configuración de entorno inválida:\n${issues}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
