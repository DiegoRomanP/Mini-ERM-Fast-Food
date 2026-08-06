import mongoose, { Schema, Document } from "mongoose";

export interface IRecipeIngredient {
  inventoryItemId: mongoose.Types.ObjectId;
  quantityNeeded: number;
}

export interface IRecipe extends Document {
  name: string;
  ingredients: IRecipeIngredient[];
}

const RecipeSchema: Schema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    ingredients: [
      {
        inventoryItemId: {
          type: Schema.Types.ObjectId,
          ref: "InventoryItem",
          required: true,
        },
        quantityNeeded: { type: Number, required: true },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<IRecipe>("Recipe", RecipeSchema);
