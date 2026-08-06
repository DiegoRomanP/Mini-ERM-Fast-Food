import { Request, Response } from "express";
import Recipe from "../models/Recipe";

export const createRecipe = async (req: Request, res: Response): Promise<void> => {
  try {
    const recipe = new Recipe(req.body);
    const saved = await recipe.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: "Error al crear receta", error });
  }
};

export const getRecipes = async (_req: Request, res: Response): Promise<void> => {
  try {
    const recipes = await Recipe.find().populate("ingredients.inventoryItemId");
    res.status(200).json(recipes);
  } catch (error) {
    res.status(500).json({ message: "Error al obtener recetas", error });
  }
};
