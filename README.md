<div align="center">
  <h1>Mini ERP</h1>
  <p><strong>Sistema de gestión de inventario con análisis predictivo</strong></p>

  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
  ![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
  ![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
  ![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
  ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
  ![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
</div>

---

## Tabla de Contenidos

- [Descripción](#descripción)
- [Tecnologías](#tecnologías)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Instalación](#instalación)
- [Uso](#uso)
- [API](#api)
- [Características](#características)
- [Licencia](#licencia)

---

## Descripción

Mini ERP es un sistema web de gestión de inventario construido con el stack MERN (MongoDB, Express, React, Node.js). Permite administrar insumos, registrar órdenes de venta con descuento automático de inventario mediante transacciones ACID, y visualizar analytics predictivos como tasa de consumo y proyección de agotamiento de stock.

Diseñado como proyecto de portafolio para demostrar habilidades en desarrollo full-stack, manejo de bases de datos NoSQL, integridad transaccional y visualización de datos.

---

## Evolución del proyecto: `api/` (Proyecto A)

El stack MERN documentado en este README (`backend/` + `frontend/`) es la
**demo funcional actual** — sigue corriendo y es lo que se ve en
producción/portafolio hoy. En paralelo, el monorepo incluye [`api/`](./api),
un backend nuevo (**Fastify 5 + PostgreSQL + Prisma**) que reescribe el
mismo dominio de negocio sobre una base relacional con autenticación JWT,
tests, Docker y CI. Es el proyecto en evolución que eventualmente
reemplazará a `backend/` una vez completado su despliegue y migrada la UI
de `frontend/` a consumirlo por completo.

Estado actual: Fases 1-7 completas (auth, dominio de negocio completo —
inventario, recetas, órdenes con transacciones ACID, analytics —,
Docker/CI); Fase 8 (despliegue en Fly.io) está **pendiente**, aún sin
desplegar. `frontend/` ya integra el login/registro contra `api/`, pero
las páginas de inventory/recipes/orders todavía consumen `backend/`.

Detalle completo del nuevo backend: [`api/README.md`](./api/README.md).
Decisiones de arquitectura (ADR): [`docs/api-decisions.md`](./docs/api-decisions.md).

---

## Tecnologías

### Backend

| Tecnología | Propósito |
|---|---|
| **Node.js** | Entorno de ejecución |
| **Express 5** | Framework web |
| **MongoDB + Mongoose 9** | Base de datos y ODM |
| **TypeScript 6** | Tipado estático |

### Frontend

| Tecnología | Propósito |
|---|---|
| **React 19** | Biblioteca de UI |
| **Vite 8** | Bundler y dev server |
| **Tailwind CSS 3** | Estilos utilitarios |
| **Recharts** | Gráficos interactivos |
| **Axios** | Cliente HTTP |
| **TypeScript 6** | Tipado estático |

---

## Estructura del Proyecto

```
mini-erp-project/
├── backend/
│   └── src/
│       ├── config/
│       │   └── db.ts                 # Conexión a MongoDB
│       ├── controllers/
│       │   ├── analyticsController.ts # Cálculo de métricas y predicciones
│       │   ├── inventoryController.ts # CRUD de insumos
│       │   ├── orderController.ts     # Órdenes con transacciones ACID
│       │   └── recipeController.ts    # Recetas del menú
│       ├── models/
│       │   ├── InventoryItem.ts       # Modelo de insumo
│       │   ├── Order.ts              # Modelo de orden
│       │   └── Recipe.ts             # Modelo de receta
│       ├── routes/
│       │   ├── analyticsRoutes.ts
│       │   ├── inventoryRoutes.ts
│       │   ├── orderRoutes.ts
│       │   └── recipeRoutes.ts
│       ├── types/
│       │   └── index.ts
│       └── index.ts                   # Entry point del servidor
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── AnalyticsDashboard.tsx  # Dashboard con gráficos y alertas
│       │   ├── ItemForm.tsx            # Formulario de insumo
│       │   ├── Modal.tsx               # Modal reutilizable
│       │   ├── ProductTable.tsx        # Tabla de inventario con acciones
│       │   ├── SearchBar.tsx           # Búsqueda en tiempo real
│       │   └── Toast.tsx              # Notificaciones
│       ├── services/
│       │   └── api.ts                  # Cliente Axios
│       ├── types/
│       │   └── index.ts
│       ├── App.tsx
│       └── main.tsx
├── LICENSE
└── README.md
```

---

## Instalación

### Requisitos

- Node.js >= 20
- MongoDB >= 7 (local o Atlas)
- npm

### Pasos

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/mini-erp-project.git
cd mini-erp-project

# Instalar dependencias del backend
cd backend
npm install

# Configurar variables de entorno
cp .env .env.example  # o crea .env con:
# PORT=3000
# MONGO_URI=mongodb://127.0.0.1:27017/mini-erp

# Instalar dependencias del frontend
cd ../frontend
npm install
```

---

## Uso

### Desarrollo

Ejecuta ambos servicios simultáneamente en terminales separadas:

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev
```

- **Backend**: `http://localhost:3000`
- **Frontend**: `http://localhost:5173`

### Producción

```bash
# Backend
cd backend
npm run build
npm start

# Frontend
cd frontend
npm run build
npm run preview
```

---

## API

### Insumos (`/api/inventory`)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/inventory` | Obtener todos los insumos |
| `POST` | `/api/inventory` | Crear un insumo |
| `PUT` | `/api/inventory/:id` | Actualizar un insumo |
| `DELETE` | `/api/inventory/:id` | Eliminar un insumo |

### Analytics (`/api/inventory/analytics`)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/inventory/analytics` | Dashboard: métricas, consumo, proyecciones |

### Órdenes (`/api/orders`)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/orders` | Listar órdenes |
| `POST` | `/api/orders` | Crear orden (descuenta stock con transacción ACID) |

### Recetas (`/api/recipes`)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/recipes` | Listar recetas |
| `POST` | `/api/recipes` | Crear receta |

---

## Características

### Fase 1 — CRUD Completo

- Tabla de inventario con búsqueda en tiempo real
- Modal para crear y editar insumos
- Eliminación con confirmación
- Notificaciones toast de éxito/error
- Alertas visuales de stock bajo

### Fase 2 — Motor de Ventas Transaccional

- Modelo de recetas con ingredientes y cantidades
- Órdenes de venta con descuento automático de inventario
- **Transacciones ACID** en MongoDB: si falla el descuento de stock, la orden se revierte completamente
- Validación de stock suficiente antes de procesar

### Fase 3 — Dashboard Analítico

- Tarjetas de resumen: total insumos, stock bajo, críticos, órdenes semanales
- **Algoritmo de proyección**: calcula la tasa de consumo promedio (burn rate) de cada insumo basado en los últimos 7 días y proyecta cuándo se agotará
- Alertas predictivas: *"Atención: El pollo se agotará en aproximadamente 2 días"*
- Gráfico de barras comparando stock actual vs mínimo (top 5)
- Gráfico de torta con distribución por categoría

---

## Licencia

Distribuido bajo la licencia MIT. Consulta el archivo [`LICENSE`](./LICENSE) para más información.

---

<div align="center">
  <sub>Hecho con ❤️ por Diego Roman</sub>
</div>
