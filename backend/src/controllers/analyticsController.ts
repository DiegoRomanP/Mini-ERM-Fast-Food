import { Request, Response } from "express";
import mongoose from "mongoose";
import InventoryItem from "../models/InventoryItem";
import Order from "../models/Order";
import Recipe from "../models/Recipe";

export const getAnalytics = async (_req: Request, res: Response): Promise<void> => {
  try {
    const items = await InventoryItem.find();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const orders = await Order.find({
      createdAt: { $gte: sevenDaysAgo },
      status: "completado",
    }).populate({
      path: "items.recipeId",
      select: "ingredients",
    });

    const consumptionMap: Record<string, number> = {};
    for (const order of orders) {
      for (const orderItem of order.items) {
        const recipe = orderItem.recipeId as unknown as { ingredients: Array<{ inventoryItemId: mongoose.Types.ObjectId; quantityNeeded: number }> } | null;
        if (recipe?.ingredients) {
          for (const ingredient of recipe.ingredients) {
            const key = ingredient.inventoryItemId.toString();
            consumptionMap[key] = (consumptionMap[key] || 0) + ingredient.quantityNeeded * orderItem.quantity;
          }
        }
      }
    }

    const analytics = items.map((item) => {
      const id = item._id.toString();
      const consumedLast7Days = consumptionMap[id] || 0;
      const dailyBurnRate = consumedLast7Days / 7;
      let daysUntilDepletion: number | null = null;

      if (dailyBurnRate > 0) {
        const stockAboveMin = item.stock - item.minStock;
        daysUntilDepletion = Math.floor(stockAboveMin / dailyBurnRate);
        if (daysUntilDepletion < 0) daysUntilDepletion = 0;
      }

      return {
        _id: item._id,
        name: item.name,
        category: item.category,
        stock: item.stock,
        minStock: item.minStock,
        unit: item.unit,
        consumedLast7Days,
        dailyBurnRate: Math.round(dailyBurnRate * 100) / 100,
        daysUntilDepletion,
        isCritical: daysUntilDepletion !== null && daysUntilDepletion <= 3,
      };
    });

    const totalItems = items.length;
    const lowStockItems = items.filter((i) => i.stock < i.minStock);
    const criticalItems = analytics.filter((a) => a.isCritical);

    res.status(200).json({
      summary: {
        totalItems,
        lowStockCount: lowStockItems.length,
        criticalCount: criticalItems.length,
        totalOrdersLast7Days: orders.length,
      },
      items: analytics,
      categoryDistribution: getCategoryDistribution(items),
    });
  } catch (error) {
    res.status(500).json({ message: "Error al obtener analytics", error });
  }
};

function getCategoryDistribution(items: { category: string }[]) {
  const map: Record<string, number> = {};
  for (const item of items) {
    map[item.category] = (map[item.category] || 0) + 1;
  }
  return Object.entries(map).map(([name, count]) => ({ name, count }));
}
