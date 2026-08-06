export interface IInventoryItem {
  _id: string;
  name: string;
  type: 'Alimento' | 'Suministro';
  category: string;
  stock: number;
  unit: string;
  minStock: number;
}

export interface InventoryFormData {
  name: string;
  type: 'Alimento' | 'Suministro';
  category: string;
  stock: number;
  unit: string;
  minStock: number;
}

export interface AnalyticsItem {
  _id: string;
  name: string;
  category: string;
  stock: number;
  minStock: number;
  unit: string;
  consumedLast7Days: number;
  dailyBurnRate: number;
  daysUntilDepletion: number | null;
  isCritical: boolean;
}

export interface CategoryCount {
  name: string;
  count: number;
}

export interface AnalyticsData {
  summary: {
    totalItems: number;
    lowStockCount: number;
    criticalCount: number;
    totalOrdersLast7Days: number;
  };
  items: AnalyticsItem[];
  categoryDistribution: CategoryCount[];
}