import axios from "axios";
import type { IInventoryItem, InventoryFormData, AnalyticsData } from "../types";

const API_URL = "http://localhost:3000/api/inventory";
const ANALYTICS_URL = "http://localhost:3000/api/inventory/analytics";

export const getInventory = async (): Promise<IInventoryItem[]> => {
  const response = await axios.get<IInventoryItem[]>(API_URL);
  return response.data;
};

export const createItem = async (data: InventoryFormData): Promise<IInventoryItem> => {
  const response = await axios.post<IInventoryItem>(API_URL, data);
  return response.data;
};

export const updateItem = async (id: string, data: InventoryFormData): Promise<IInventoryItem> => {
  const response = await axios.put<IInventoryItem>(`${API_URL}/${id}`, data);
  return response.data;
};

export const deleteItem = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/${id}`);
};

export const getAnalytics = async (): Promise<AnalyticsData> => {
  const response = await axios.get<AnalyticsData>(ANALYTICS_URL);
  return response.data;
};