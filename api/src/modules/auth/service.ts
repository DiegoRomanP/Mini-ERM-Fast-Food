import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Role, User } from '@prisma/client';
import { AppError } from '../../shared/http-errors.js';
import { REFRESH_TOKEN_TTL_MS } from '../../plugins/auth.js';
import { authRepository, type AuthRepository } from './repository.js';
import type { UserDto } from './schema.js';

const BCRYPT_SALT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 48;
const GENERIC_INVALID_CREDENTIALS = 'Credenciales inválidas';
const GENERIC_INVALID_REFRESH = 'Sesión inválida o expirada';

/**
 * Hash bcrypt "de relleno" usado para comparar contra él cuando el email no
 * existe. Mantiene el tiempo de respuesta de login similar al caso de
 * password incorrecto, para no filtrar por timing si un email está
 * registrado o no.
 */
const DUMMY_BCRYPT_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeOgOZfXJz0Nf.9F.hOZjXfQqDcz8XdX9C';

export type SignAccessToken = (payload: { sub: string; role: Role }) => string;

export interface AuthServiceDeps {
  signAccessToken: SignAccessToken;
  repository?: AuthRepository;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  user: UserDto;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Hashea el refresh token con SHA-256 antes de persistirlo.
 *
 * Decisión: a diferencia de la password (bcrypt, lento a propósito para
 * resistir fuerza bruta sobre un secreto de baja entropía elegido por un
 * humano), el refresh token es un valor aleatorio de 48 bytes generado por
 * el servidor: ya tiene entropía suficiente para no ser adivinable, así que
 * un hash rápido y determinista (SHA-256) alcanza para detectar
 * modificación/robo de la cookie sin pagar el costo de bcrypt en cada
 * refresh. Además SHA-256 permite buscar por `tokenHash` con un índice único
 * exacto (bcrypt genera un salt distinto cada vez y no permite lookup
 * directo).
 */
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshTokenPlain(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

function toUserDto(user: User): UserDto {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly signAccessToken: SignAccessToken;

  constructor(deps: AuthServiceDeps) {
    this.repository = deps.repository ?? authRepository;
    this.signAccessToken = deps.signAccessToken;
  }

  async register(input: RegisterInput): Promise<AuthTokens> {
    const existing = await this.repository.findUserByEmail(input.email);
    if (existing) {
      throw AppError.conflict('El email ya está registrado', 'EMAIL_ALREADY_EXISTS');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
    const user = await this.repository.createUser({
      email: input.email,
      passwordHash,
      name: input.name,
    });

    return this.issueTokens(user);
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const user = await this.repository.findUserByEmail(input.email);
    if (!user) {
      await bcrypt.compare(input.password, DUMMY_BCRYPT_HASH);
      throw AppError.unauthorized(GENERIC_INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    }

    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordMatches) {
      throw AppError.unauthorized(GENERIC_INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    }

    return this.issueTokens(user);
  }

  /**
   * Verifica el refresh token recibido (ya sin firma de cookie) y realiza
   * rotación: revoca el token existente y emite uno nuevo. Si la cookie
   * falta, no corresponde a ningún token, ya fue revocada o expiró, lanza
   * 401 sin distinguir el motivo (mismo criterio que login).
   */
  async refresh(refreshTokenPlain: string | undefined): Promise<RefreshResult> {
    const stored = await this.getActiveRefreshToken(refreshTokenPlain);

    const user = await this.repository.findUserById(stored.userId);
    if (!user) {
      throw AppError.unauthorized(GENERIC_INVALID_REFRESH, 'INVALID_REFRESH_TOKEN');
    }

    await this.repository.revokeRefreshToken(stored.id);

    const { accessToken, refreshToken } = await this.issueTokens(user);
    return { accessToken, refreshToken };
  }

  /**
   * Revoca el refresh token asociado a la cookie, si existe y sigue activo.
   * Es intencionalmente permisivo (no lanza si la cookie falta o ya no es
   * válida): logout debe poder llamarse siempre y limpiar la sesión del
   * lado del cliente.
   */
  async logout(refreshTokenPlain: string | undefined): Promise<void> {
    if (!refreshTokenPlain) {
      return;
    }

    const tokenHash = hashRefreshToken(refreshTokenPlain);
    const stored = await this.repository.findRefreshTokenByHash(tokenHash);
    if (stored && !stored.revokedAt) {
      await this.repository.revokeRefreshToken(stored.id);
    }
  }

  private async getActiveRefreshToken(refreshTokenPlain: string | undefined) {
    if (!refreshTokenPlain) {
      throw AppError.unauthorized(GENERIC_INVALID_REFRESH, 'INVALID_REFRESH_TOKEN');
    }

    const tokenHash = hashRefreshToken(refreshTokenPlain);
    const stored = await this.repository.findRefreshTokenByHash(tokenHash);
    if (!stored || stored.revokedAt !== null || stored.expiresAt.getTime() < Date.now()) {
      throw AppError.unauthorized(GENERIC_INVALID_REFRESH, 'INVALID_REFRESH_TOKEN');
    }

    return stored;
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessToken = this.signAccessToken({ sub: user.id, role: user.role });
    const refreshTokenPlain = generateRefreshTokenPlain();

    await this.repository.createRefreshToken({
      userId: user.id,
      tokenHash: hashRefreshToken(refreshTokenPlain),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    return {
      user: toUserDto(user),
      accessToken,
      refreshToken: refreshTokenPlain,
    };
  }
}
