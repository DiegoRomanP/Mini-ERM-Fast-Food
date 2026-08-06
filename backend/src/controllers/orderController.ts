import { Request, Response } from "express";
import mongoose from "mongoose";
import Order from "../models/Order";
import Recipe from "../models/Recipe";
import InventoryItem from "../models/InventoryItem";

export const createOrder = async (req: Request, res: Response): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { items } = req.body;

    interface OrderItemInput {
      recipeId: string;
      quantity: number;
    }

    const orderItems: { recipeId: mongoose.Types.ObjectId; recipeName: string; quantity: number }[] = [];
    let total = 0;

    for (const item of items as OrderItemInput[]) {
      const recipe = await Recipe.findById(item.recipeId).session(session);
      if (!recipe) {
        await session.abortTransaction();
        session.endSession();
        res.status(404).json({ message: `Receta ${item.recipeId} no encontrada` });
        return;
      }

      for (const ingredient of recipe.ingredients) {
        const inventoryItem = await InventoryItem.findById(ingredient.inventoryItemId).session(session);
        if (!inventoryItem) {
          await session.abortTransaction();
          session.endSession();
          res.status(404).json({ message: `Insumo ${ingredient.inventoryItemId} no encontrado` });
          return;
        }

        const totalNeeded = ingredient.quantityNeeded * item.quantity;
        if (inventoryItem.stock < totalNeeded) {
          await session.abortTransaction();
          session.endSession();
          res.status(400).json({
            message: `Stock insuficiente para ${inventoryItem.name}. Necesitas ${totalNeeded}${inventoryItem.unit}, tienes ${inventoryItem.stock}`,
          });
          return;
        }

        await InventoryItem.findByIdAndUpdate(
          ingredient.inventoryItemId,
          { $inc: { stock: -totalNeeded } },
          { session }
        );
      }

      orderItems.push({
        recipeId: recipe._id as mongoose.Types.ObjectId,
        recipeName: recipe.name,
        quantity: item.quantity,
      });

      for (const ingredient of recipe.ingredients) {
        const inventoryItem = await InventoryItem.findById(ingredient.inventoryItemId).session(session);
        if (inventoryItem) {
          total += ingredient.quantityNeeded * item.quantity * inventoryItem.pricePerUnit;
        }
      }
    }

    const order = new Order({ items: orderItems, total });
    await order.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json(order);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: "Error al crear la orden", error });
  }
};

export const getOrders = async (_req: Request, res: Response): Promise<void> => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: "Error al obtener órdenes", error });
  }
};
