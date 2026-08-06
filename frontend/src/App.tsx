import { useEffect, useState } from "react";
import { getInventory, createItem, updateItem, deleteItem } from "./services/api";
import type { IInventoryItem, InventoryFormData } from "./types";
import { SearchBar } from "./components/SearchBar";
import { ProductTable } from "./components/ProductTable";
import { Modal } from "./components/Modal";
import { ItemForm } from "./components/ItemForm";
import { Toast } from "./components/Toast";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import type { ToastData } from "./components/Toast";

function App() {
  const [items, setItems] = useState<IInventoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<IInventoryItem | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const data = await getInventory();
        setItems(data);
      } catch {
        setToast({ message: "Error al conectar con el servidor", type: "error" });
      }
    };
    fetchItems();
  }, []);

  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openCreateModal = () => {
    setEditingItem(null);
    setModalOpen(true);
  };

  const openEditModal = (item: IInventoryItem) => {
    setEditingItem(item);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingItem(null);
  };

  const handleSubmit = async (data: InventoryFormData) => {
    try {
      if (editingItem) {
        const updated = await updateItem(editingItem._id, data);
        setItems((prev) => prev.map((i) => (i._id === updated._id ? updated : i)));
        setToast({ message: "Insumo actualizado correctamente", type: "success" });
      } else {
        const created = await createItem(data);
        setItems((prev) => [...prev, created]);
        setToast({ message: "Insumo creado correctamente", type: "success" });
      }
      closeModal();
    } catch {
      setToast({ message: "Error al guardar el insumo", type: "error" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Estás seguro de eliminar este insumo?")) return;
    try {
      await deleteItem(id);
      setItems((prev) => prev.filter((i) => i._id !== id));
      setToast({ message: "Insumo eliminado correctamente", type: "success" });
    } catch {
      setToast({ message: "Error al eliminar el insumo", type: "error" });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gestión de Inventario</h1>
            <p className="text-gray-600 mt-1">Control de insumos para Mini-ERP</p>
          </div>
          <button onClick={openCreateModal}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            + Nuevo Insumo
          </button>
        </div>
        <AnalyticsDashboard />
        <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
        <ProductTable items={filteredItems} onEdit={openEditModal} onDelete={handleDelete} />

        <Modal isOpen={modalOpen} onClose={closeModal} title={editingItem ? "Editar Insumo" : "Nuevo Insumo"}>
          <ItemForm
            initialData={editingItem ?? undefined}
            onSubmit={handleSubmit}
            onCancel={closeModal}
          />
        </Modal>

        <Toast toast={toast} onClose={() => setToast(null)} />
      </div>
    </div>
  );
}

export default App;
