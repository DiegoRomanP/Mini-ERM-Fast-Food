import mongoose, { Schema, Document } from "mongoose";

// 1. Definimos la interfaz TypeScript para este documento
export interface IInventoryItem extends Document {
  name: string;
  type: "Alimento" | "Suministro";
  category: string; // ej: 'Carnes', 'Frutas', 'Empaques'
  stock: number;
  unit: "kg" | "litros" | "unidades" | "paquetes";
  minStock: number;
  pricePerUnit: number; // Costo para el negocio (opcional, pero da puntos extra)
}

// 2. Creamos el esquema de Mongoose
const InventoryItemSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["Alimento", "Suministro"], // Solo acepta estos dos valores
    },
    category: {
      type: String,
      required: true,
    },
    stock: {
      type: Number,
      required: true,
      default: 0,
    },
    unit: {
      type: String,
      required: true,
      enum: ["kg", "litros", "unidades", "paquetes"],
    },
    minStock: {
      type: Number,
      required: true,
      default: 5, // Por defecto 5, cumpliendo el requerimiento de tu proyecto
    },
    pricePerUnit: {
      type: Number,
      required: false, // Lo dejamos opcional para no complicar la creación
      default: 0,
    },
  },
  {
    timestamps: true, // Crea automáticamente 'createdAt' y 'updatedAt'
  },
);

// 3. Exportamos el modelo
export default mongoose.model<IInventoryItem>(
  "InventoryItem",
  InventoryItemSchema,
);
