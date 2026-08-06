import type { IInventoryItem } from "../types";

interface ProductTableProps {
    items: IInventoryItem[];
    onEdit: (item: IInventoryItem) => void;
    onDelete: (id: string) => void;
}

export const ProductTable = ({ items, onEdit, onDelete }: ProductTableProps) => {
    if (items.length === 0) {
        return <p className="text-gray-500 text-center py-4">No hay insumos que coincidan con la búsqueda.</p>;
    }

    return (
        <div className="overflow-x-auto bg-white rounded-lg shadow">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-gray-800 text-white">
                        <th className="p-4 rounded-tl-lg">Nombre</th>
                        <th className="p-4">Categoría</th>
                        <th className="p-4">Tipo</th>
                        <th className="p-4 text-center">Stock</th>
                        <th className="p-4">Unidad</th>
                        <th className="p-4 rounded-tr-lg">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {items.map((item) => {
                        const isLowStock = item.stock < item.minStock;
                        return (
                            <tr
                                key={item._id}
                                className={`transition-colors ${isLowStock ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`}
                            >
                                <td className="p-4 font-medium text-gray-900">{item.name}</td>
                                <td className="p-4 text-gray-600">{item.category}</td>
                                <td className="p-4 text-gray-600">{item.type}</td>
                                <td className={`p-4 text-center font-bold ${isLowStock ? 'text-red-600' : 'text-green-600'}`}>
                                    {item.stock} {isLowStock && '⚠️'}
                                </td>
                                <td className="p-4 text-gray-600">{item.unit}</td>
                                <td className="p-4">
                                    <div className="flex gap-2">
                                        <button onClick={() => onEdit(item)}
                                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                            title="Editar">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                            </svg>
                                        </button>
                                        <button onClick={() => onDelete(item._id)}
                                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                                            title="Eliminar">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                            </svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
