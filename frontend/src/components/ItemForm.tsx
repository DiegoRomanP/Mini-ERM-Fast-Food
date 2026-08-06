import { useState } from "react";
import type { InventoryFormData } from "../types";

interface ItemFormProps {
  initialData?: InventoryFormData;
  onSubmit: (data: InventoryFormData) => Promise<void>;
  onCancel: () => void;
}

const defaultFormData: InventoryFormData = {
  name: "",
  type: "Alimento",
  category: "",
  stock: 0,
  unit: "unidades",
  minStock: 5,
};

export const ItemForm = ({ initialData, onSubmit, onCancel }: ItemFormProps) => {
  const [form, setForm] = useState<InventoryFormData>(initialData ?? defaultFormData);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: name === "stock" || name === "minStock" ? Number(value) : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
        <input type="text" name="name" value={form.name} onChange={handleChange} required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
        <select name="type" value={form.type} onChange={handleChange}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="Alimento">Alimento</option>
          <option value="Suministro">Suministro</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
        <input type="text" name="category" value={form.category} onChange={handleChange} required
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Stock</label>
          <input type="number" name="stock" value={form.stock} onChange={handleChange} min={0} required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Stock Mínimo</label>
          <input type="number" name="minStock" value={form.minStock} onChange={handleChange} min={0} required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Unidad</label>
        <select name="unit" value={form.unit} onChange={handleChange}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="kg">kg</option>
          <option value="litros">litros</option>
          <option value="unidades">unidades</option>
          <option value="paquetes">paquetes</option>
        </select>
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={submitting}
          className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {submitting ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </form>
  );
};
