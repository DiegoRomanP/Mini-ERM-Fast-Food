import { Request, Response } from 'express';
import InventoryItem from '../models/InventoryItem';

export const createItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const newItem = new InventoryItem(req.body);
    const savedItem = await newItem.save();
    res.status(201).json(savedItem);
  } catch (error) {
    res.status(400).json({ message: "Error al crear el ítem", error });
  }
};
// Leer todos los ítems
export const getItems = async (req: Request, res: Response): Promise<void> => {
  try {
    const items = await InventoryItem.find();
    res.status(200).json(items);
  } catch (error) {
    res.status(500).json({ message: "Error al obtener el inventario", error });
  }
};

// Actualizar un ítem específico
export const updateItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    // { new: true } le dice a Mongoose que devuelva el objeto ya actualizado
    const updatedItem = await InventoryItem.findByIdAndUpdate(id, req.body, { new: true });
    
    if (!updatedItem) {
      res.status(404).json({ message: "Ítem no encontrado" });
      return;
    }
    
    res.status(200).json(updatedItem);
  } catch (error) {
    res.status(400).json({ message: "Error al actualizar", error });
  }
};

// Eliminar un ítem
export const deleteItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const deletedItem = await InventoryItem.findByIdAndDelete(id);
    
    if (!deletedItem) {
      res.status(404).json({ message: "Ítem no encontrado" });
      return;
    }
    
    res.status(200).json({ message: "Ítem eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ message: "Error al eliminar", error });
  }
};