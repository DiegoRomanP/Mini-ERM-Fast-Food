import { useEffect, useState } from "react";
import { getAnalytics } from "../services/api";
import type { AnalyticsData } from "../types";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

const COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];

export const AnalyticsDashboard = () => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await getAnalytics();
        setData(result);
      } catch {
        console.error("Error al obtener analytics");
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Cargando analytics...</div>;
  }

  if (!data) {
    return <div className="text-center py-8 text-red-500">Error al cargar analytics</div>;
  }

  const lowStockItems = data.items.filter((i) => i.stock < i.minStock).slice(0, 5);
  const criticalItems = data.items.filter((i) => i.isCritical);

  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Dashboard Analítico</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-500">Total Insumos</p>
          <p className="text-2xl font-bold text-gray-900">{data.summary.totalItems}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-500">Stock Bajo</p>
          <p className="text-2xl font-bold text-red-600">{data.summary.lowStockCount}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-500">Críticos (&le;3 días)</p>
          <p className="text-2xl font-bold text-orange-600">{data.summary.criticalCount}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-sm text-gray-500">Órdenes (7d)</p>
          <p className="text-2xl font-bold text-blue-600">{data.summary.totalOrdersLast7Days}</p>
        </div>
      </div>

      {criticalItems.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <h3 className="text-red-800 font-semibold mb-2">Alertas Predictivas</h3>
          {criticalItems.map((item) => (
            <p key={item._id} className="text-red-700 text-sm">
              Atención: {item.name} se agotará en aproximadamente {item.daysUntilDepletion} día{item.daysUntilDepletion !== 1 ? "s" : ""}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Top 5 Stock Bajo</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={lowStockItems}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="stock" fill="#ef4444" name="Stock actual" />
              <Bar dataKey="minStock" fill="#3b82f6" name="Stock mínimo" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Distribución por Categoría</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={data.categoryDistribution} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {data.categoryDistribution.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
