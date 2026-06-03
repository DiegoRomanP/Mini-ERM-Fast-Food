export interface IInventoryItem {
  _id: string; // Mongo siempre devuelve el ID con guion bajo
  name: string;
  type: 'Alimento' | 'Suministro';
  category: string;
  stock: number;
  unit: string;
  minStock: number;
}