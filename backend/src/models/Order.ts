import mongoose, { Schema, Document } from "mongoose";

export interface IOrderItem {
  recipeId: mongoose.Types.ObjectId;
  recipeName: string;
  quantity: number;
}

export interface IOrder extends Document {
  items: IOrderItem[];
  total: number;
  status: "pendiente" | "completado" | "cancelado";
}

const OrderSchema: Schema = new Schema(
  {
    items: [
      {
        recipeId: { type: Schema.Types.ObjectId, ref: "Recipe", required: true },
        recipeName: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
      },
    ],
    total: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ["pendiente", "completado", "cancelado"],
      default: "pendiente",
    },
  },
  { timestamps: true }
);

export default mongoose.model<IOrder>("Order", OrderSchema);
