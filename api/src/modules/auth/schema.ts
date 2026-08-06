// fastify-type-provider-zod v5 valida contra el motor interno de Zod v4
// (`zod/v4/core`). El paquete `zod` instalado (3.25.x) empaqueta ambas APIs;
// hay que importar explícitamente el subpath `zod/v4` para los schemas de
// ruta — importar el default ("zod", API v3 clásica) rompe la validación en
// runtime con un error interno ("Cannot read properties of undefined
// (reading 'run')") porque el compiler v5 espera instancias `$ZodType` v4.
import { z } from 'zod/v4';

const MIN_PASSWORD_LENGTH = 8;

export const RegisterBodySchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`),
  name: z.string().min(1, 'El nombre es requerido'),
});
export type RegisterBody = z.infer<typeof RegisterBodySchema>;

export const LoginBodySchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
});
export type LoginBody = z.infer<typeof LoginBodySchema>;

/** DTO público de usuario: nunca incluye `passwordHash`. */
export const UserDtoSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['ADMIN', 'USER']),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export const AuthResponseSchema = z.object({
  user: UserDtoSchema,
  accessToken: z.string(),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;
