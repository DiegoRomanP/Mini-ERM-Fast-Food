import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AnalyticsService } from './service.js';
import type { BurnRateQuery } from './schema.js';

const HTTP_OK = 200;

export interface AnalyticsController {
  burnRate(request: FastifyRequest<{ Querystring: BurnRateQuery }>, reply: FastifyReply): Promise<void>;
}

export function createAnalyticsController(analyticsService: AnalyticsService): AnalyticsController {
  return {
    async burnRate(request, reply) {
      const result = await analyticsService.burnRate(request.query.days);
      await reply.code(HTTP_OK).send(result);
    },
  };
}
