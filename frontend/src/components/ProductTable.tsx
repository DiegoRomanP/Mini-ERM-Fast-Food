import type { IInventoryItem } from "../types";

interface ProductTableProps {
    items: IInventoryItem[];
}

export const ProductTable = ({ items }: ProductTableProps) => {
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
                        <th className="p-4 rounded-tr-lg">Unidad</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {items.map((item) => {
                        // LÓGICA DE ALERTA DE STOCK BAJO
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
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};