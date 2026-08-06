import type { InventoryItem } from '@prisma/client';
import { inventoryRepository, type InventoryRepository } from '../inventory/repository.js';
import { analyticsRepository, type AnalyticsRepository } from './repository.js';
import type { BurnRateItem, BurnRateResponse, RiskFlag } from './schema.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Umbral (en días) para marcar un item como `'RIESGO'`: todavía no está en
 * `'CRITICO'` (stock por encima de `minStock` hoy), pero al ritmo de
 * consumo estimado alcanzará el mínimo dentro de esta ventana. Se eligió
 * 7 días porque es un margen operativo razonable para reordenar a un
 * proveedor sin caer en falsos positivos permanentes en items de consumo
 * lento — un umbral más corto (p. ej. 2-3 días) dejaría muy poco margen de
 * reacción; uno más largo (30 días) marcaría como "en riesgo" casi
 * cualquier item con algo de consumo, degradando la señal.
 */
const RISK_THRESHOLD_DAYS = 7;

export interface AnalyticsServiceDeps {
  repository?: AnalyticsRepository;
  inventoryRepository?: InventoryRepository;
}

/**
 * Fórmula de riesgo por item (documentada también en `schema.ts` junto al
 * enum `RiskFlagSchema`):
 * 1. `'CRITICO'` si `stock <= minStock` YA, en este momento — sin importar
 *    el consumo estimado, es la señal más fuerte y siempre gana.
 * 2. `'RIESGO'` si no es crítico todavía pero `daysUntilMinStock` no es
 *    `null` (hay consumo reciente medible) y es `<= RISK_THRESHOLD_DAYS`.
 * 3. `'OK'` en cualquier otro caso, incluido "sin consumo reciente"
 *    (`daysUntilMinStock === null`): no hay datos suficientes para
 *    proyectar riesgo, así que se reporta sin riesgo en vez de asumirlo.
 */
function computeRiskFlag(stock: number, minStock: number, daysUntilMinStock: number | null): RiskFlag {
  if (stock <= minStock) {
    return 'CRITICO';
  }
  if (daysUntilMinStock !== null && daysUntilMinStock <= RISK_THRESHOLD_DAYS) {
    return 'RIESGO';
  }
  return 'OK';
}

function toBurnRateItem(item: InventoryItem, totalConsumption: number, days: number): BurnRateItem {
  const dailyConsumption = totalConsumption / days;
  // `dailyConsumption > 0` en vez de `!== 0`: el consumo total viene de
  // sumar cantidades positivas (`quantityNeeded > 0` por validación de
  // `IngredientSchema`, `quantity` de OrderItem también positivo), así que
  // nunca es negativo; la guarda contra división por cero solo necesita
  // descartar el caso 0.
  const daysUntilMinStock = dailyConsumption > 0 ? (item.stock - item.minStock) / dailyConsumption : null;

  return {
    inventoryItemId: item.id,
    name: item.name,
    stock: item.stock,
    minStock: item.minStock,
    dailyConsumption,
    daysUntilMinStock,
    riskFlag: computeRiskFlag(item.stock, item.minStock, daysUntilMinStock),
  };
}

export class AnalyticsService {
  private readonly repository: AnalyticsRepository;
  private readonly inventoryRepository: InventoryRepository;

  constructor(deps: AnalyticsServiceDeps = {}) {
    this.repository = deps.repository ?? analyticsRepository;
    this.inventoryRepository = deps.inventoryRepository ?? inventoryRepository;
  }

  async burnRate(days: number): Promise<BurnRateResponse> {
    const cutoff = new Date(Date.now() - days * MS_PER_DAY);

    const [items, consumptionByItemId] = await Promise.all([
      this.inventoryRepository.findAll(),
      this.repository.findConsumptionSince(cutoff),
    ]);

    return {
      days,
      generatedAt: new Date(),
      items: items.map((item) => toBurnRateItem(item, consumptionByItemId.get(item.id) ?? 0, days)),
    };
  }
}
