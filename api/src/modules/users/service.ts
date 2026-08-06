import type { Role, User } from '@prisma/client';
import { AppError } from '../../shared/http-errors.js';
import { buildPaginationMeta, paginationSkipTake } from '../../shared/pagination.js';
import type { PaginatedResult } from '../../shared/pagination.js';
import { usersRepository, type UsersRepository } from './repository.js';
import type { UserDto } from './schema.js';

export interface ListUsersInput {
  page: number;
  limit: number;
  q?: string;
}

export interface UsersServiceDeps {
  repository?: UsersRepository;
}

function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class UsersService {
  private readonly repository: UsersRepository;

  constructor(deps: UsersServiceDeps = {}) {
    this.repository = deps.repository ?? usersRepository;
  }

  async list(input: ListUsersInput): Promise<PaginatedResult<UserDto>> {
    const { skip, take } = paginationSkipTake({ page: input.page, limit: input.limit });
    const { users, total } = await this.repository.findMany({ skip, take, q: input.q });

    return {
      data: users.map(toUserDto),
      meta: buildPaginationMeta({ page: input.page, limit: input.limit, total }),
    };
  }

  async updateRole(id: string, role: Role): Promise<UserDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw AppError.notFound('Usuario no encontrado', 'USER_NOT_FOUND');
    }

    const updated = await this.repository.updateRole(id, role);
    return toUserDto(updated);
  }
}
