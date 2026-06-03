import axios from "axios";
import { IInventoryItem } from "../types";

// En desarrollo apuntará a tu backend local.
// En la Fase 7 (Despliegue), cambiaremos esto por la URL de Render.
const API_URL = "http://localhost:3000/api/inventory";

export const getInventory = async (): Promise<IInventoryItem[]> => {
  const response = await axios.get<IInventoryItem[]>(API_URL);
  return response.data;
};