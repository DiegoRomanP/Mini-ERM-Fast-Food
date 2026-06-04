import { useEffect, useState } from "react";
import { getInventory } from "./services/api";
import type { IInventoryItem } from "./types";
import { SearchBar } from "./components/SearchBar";
import { ProductTable } from "./components/ProductTable";

function App() {
  const [items, setItems] = useState<IInventoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>("");

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const data = await getInventory();
        setItems(data);
      } catch (error) {
        console.error("Error conectando con el backend:", error);
      }
    };
    fetchItems();
  }, []);

  // LÓGICA DEL BUSCADOR EN TIEMPO REAL
  // Filtramos la lista en memoria cada vez que searchTerm cambia
  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-5xl mx-auto">

        {/* Cabecera */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gestión de Inventario</h1>
            <p className="text-gray-600 mt-1">Control de insumos para Mini-ERP</p>
          </div>
          {/* Aquí irá el botón para agregar nuevos productos en el futuro */}
        </div>

        {/* Componentes */}
        <SearchBar searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
        <ProductTable items={filteredItems} />

      </div>
    </div>
  );
}

export default App;