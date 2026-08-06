import { Router } from "express";
import { createRecipe, getRecipes } from "../controllers/recipeController";

const router = Router();

router.post("/", createRecipe);
router.get("/", getRecipes);

export default router;
