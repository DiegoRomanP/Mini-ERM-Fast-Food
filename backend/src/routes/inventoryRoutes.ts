import { Router } from "express";
import {
  createItem /*, getItems, updateItem, deleteItem */,
} from "../controllers/inventoryController";

const router = Router();

router.post("/", createItem);
router.get("/", getItems);
router.put("/:id", updateItem);
router.delete("/:id", deleteItem);

export default router;
