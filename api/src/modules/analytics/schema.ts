// Ver `modules/auth/schema.ts` para el detalle del workaround: hay que
// importar `zod/v4` (no `zod`) porque fastify-type-provider-zod@5 valida
// contra el engine interno de Zod v4 y el paquete `zod` instalado resuelve
// por defecto a la API v3 clásica.
import { z } from 'zod/v4';

/** Ventana de días por defecto cuando `?days` no viene en el querystring. */
export const DEFAULT_BURN_RATE_DAYS = 30;
/**
 * Tope máximo aceptado de `?days`, para evitar abuso (una ventana enorme
 * fuerza a escanear años de `Order`/`OrderItem` en cada request). 365 cubre
 * cualquier análisis razonable de burn-rate ("último año") sin permitir un
 * rango sin límite.
 */
export const MAX_BURN_RATE_DAYS = 365;

export const BurnRateQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_BURN_RATE_DAYS).default(DEFAULT_BURN_RATE_DAYS),
});
export type BurnRateQuery = z.infer<typeof BurnRateQuerySchema>;

/**
 * Nivel de riesgo de agotar stock, calculado por item (ver
 * `service.ts#computeRiskFlag` para la fórmula exacta):
 * - `CRITICO`: el stock actual ya está en o por debajo de `minStock`.
 * - `RIESGO`: todavía no está crítico, pero al ritmo de consumo estimado
 *   llegará al mínimo dentro de `RISK_THRESHOLD_DAYS` (7 días).
 * - `OK`: ni lo anterior, incluye el caso sin consumo reciente
 *   (`dailyConsumption === 0`), donde no hay datos suficientes para
 *   proyectar riesgo.
 */
export const RiskFlagSchema = z.enum(['OK', 'RIESGO', 'CRITICO']);
export type RiskFlag = z.infer<typeof RiskFlagSchema>;

export const BurnRateItemSchema = z.object({
  inventoryItemId: z.string(),
  name: z.string(),
  stock: z.number(),
  minStock: z.number(),
  /** Consumo diario estimado en la ventana `days`: `totalConsumido / days`. */
  dailyConsumption: z.number(),
  /**
   * `(stock - minStock) / dailyConsumption`. `null` cuando
   * `dailyConsumption === 0` (sin consumo reciente en la ventana): no se
   * puede proyectar una fecha de agotamiento sin dividir entre cero.
   */
  daysUntilMinStock: z.number().nullable(),
  riskFlag: RiskFlagSchema,
});
export type BurnRateItem = z.infer<typeof BurnRateItemSchema>;

export const BurnRateResponseSchema = z.object({
  days: z.number().int(),
  generatedAt: z.date(),
  items: z.array(BurnRateItemSchema),
});
export type BurnRateResponse = z.infer<typeof BurnRateResponseSchema>;
