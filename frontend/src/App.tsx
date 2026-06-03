import { useEffect, useState } from "react";
import { getInventory } from "./services/api";
import { IInventoryItem } from "./types";

function App() {
  // 1. Definimos el estado central: un arreglo de ítems vacío al inicio
  const [items, setItems] = useState<IInventoryItem[]>([]);

  // 2. useEffect ejecuta esta lógica apenas carga la pantalla
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
  }, []); // El arreglo vacío indica que solo se ejecuta una vez

  // 3. Renderizado básico para comprobar la conexión
  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto bg-white shadow-md rounded-lg p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">
          Mini-ERP: Inventario
        </h1>
        
        {/* Renderizamos el JSON crudo temporalmente para verificar */}
        <pre className="bg-gray-800 text-green-400 p-4 rounded overflow-auto">
          {JSON.stringify(items, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export default App;