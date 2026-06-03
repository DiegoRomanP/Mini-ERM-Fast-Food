export interface InventoryItemDTO {
  name: string;
  type: 'Alimento' | 'Suministro';
  category: string;
  stock: number;
  unit: string;
  minStock: number;
  pricePerUnit?: number;
}