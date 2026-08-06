<div align="center">
  <h1>Mini ERP — Backend</h1>
  <p><strong>API RESTful para gestión de inventario, órdenes y analytics</strong></p>

  ![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
  ![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
  ![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
</div>

---

## Descripción

API REST construida con Node.js + Express + MongoDB que maneja el núcleo de lógica de negocio del Mini ERP. Incluye CRUD de insumos, gestión de recetas, registro de órdenes con descuento automático de stock mediante transacciones ACID, y un endpoint analítico con algoritmo de proyección de agotamiento.

---

## Tecnologías

| Tecnología | Versión | Propósito |
|---|---|---|
| Node.js | >= 20 | Entorno de ejecución |
| Express | 5.2.1 | Framework HTTP |
| Mongoose | 9.6.2 | ODM para MongoDB |
| TypeScript | 6.0.3 | Tipado estático |
| ts-node-dev | 2.0.0 | Recarga en caliente en desarrollo |

---

## Estructura

```
backend/
├── src/
│   ├── config/
│   │   └── db.ts                  # Conexión a MongoDB
│   ├── controllers/
│   │   ├── analyticsController.ts  # Métricas, burn rate, proyección
│   │   ├── inventoryController.ts  # CRUD de insumos
│   │   ├── orderController.ts      # Órdenes con transacciones ACID
│   │   └── recipeController.ts     # Recetas del menú
│   ├── models/
│   │   ├── InventoryItem.ts        # Esquema de insumo
│   │   ├── Order.ts               # Esquema de orden
│   │   └── Recipe.ts              # Esquema de receta
│   ├── routes/
│   │   ├── analyticsRoutes.ts
│   │   ├── inventoryRoutes.ts
│   │   ├── orderRoutes.ts
│   │   └── recipeRoutes.ts
│   ├── types/
│   │   └── index.ts               # DTOs compartidos
│   └── index.ts                    # Entry point del servidor
├── .env                            # Variables de entorno
├── tsconfig.json
└── package.json
```

---

## Instalación

```bash
cd backend
npm install
```

Crear archivo `.env`:

```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/mini-erp
```

---

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Inicia servidor con recarga automática (`ts-node-dev`) |
| `npm run build` | Compila TypeScript a JavaScript (`tsc`) |
| `npm start` | Ejecuta el build en producción |

---

## API

### Insumos — `/api/inventory`

```http
GET    /api/inventory        # Listar todos los insumos
POST   /api/inventory        # Crear un insumo
PUT    /api/inventory/:id    # Actualizar un insumo
DELETE /api/inventory/:id    # Eliminar un insumo
```

**Body (POST/PUT):**

```json
{
  "name": "Pechuga de pollo",
  "type": "Alimento",
  "category": "Carnes",
  "stock": 50,
  "unit": "kg",
  "minStock": 10,
  "pricePerUnit": 45
}
```

### Analytics — `/api/inventory/analytics`

```http
GET /api/inventory/analytics
```

Devuelve:
- **summary**: total de insumos, cantidad con stock bajo, críticos, órdenes semanales
- **items**: por cada insumo — consumo semanal, tasa diaria, días hasta agotamiento, alerta crítica
- **categoryDistribution**: histograma de categorías

### Órdenes — `/api/orders`

```http
GET  /api/orders          # Listar órdenes (más recientes primero)
POST /api/orders          # Crear orden (descuenta stock atómicamente)
```

**Body (POST):**

```json
{
  "items": [
    { "recipeId": "665...abc", "quantity": 2 },
    { "recipeId": "665...def", "quantity": 1 }
  ]
}
```

### Recetas — `/api/recipes`

```http
GET  /api/recipes          # Listar recetas con ingredientes poblados
POST /api/recipes          # Crear receta
```

**Body (POST):**

```json
{
  "name": "Hamburguesa",
  "ingredients": [
    { "inventoryItemId": "665...abc", "quantityNeeded": 0.2 },
    { "inventoryItemId": "665...def", "quantityNeeded": 1 }
  ]
}
```

---

## Transacciones ACID

El endpoint `POST /api/orders` utiliza sesiones y transacciones nativas de MongoDB para garantizar atomicidad:

1. Inicia una sesión y una transacción
2. Verifica que todas las recetas e insumos existan
3. Valida que haya stock suficiente para cada ingrediente
4. Descuenta el stock de cada insumo afectado
5. Crea el registro de la orden
6. Si algo falla en cualquier paso, la transacción se revierte (*rollback*) y el stock no se descuenta

---

## Modelos

### InventoryItem

| Campo | Tipo | Requerido |
|---|---|---|
| name | String | Sí |
| type | enum: Alimento, Suministro | Sí |
| category | String | Sí |
| stock | Number | Sí (default 0) |
| unit | enum: kg, litros, unidades, paquetes | Sí |
| minStock | Number | Sí (default 5) |
| pricePerUnit | Number | No |

### Recipe

| Campo | Tipo | Descripción |
|---|---|---|
| name | String | Nombre único |
| ingredients | Array | `[{ inventoryItemId: ObjectId, quantityNeeded: Number }]` |

### Order

| Campo | Tipo | Descripción |
|---|---|---|
| items | Array | `[{ recipeId: ObjectId, recipeName: String, quantity: Number }]` |
| total | Number | Suma calculada |
| status | enum: pendiente, completado, cancelado | default: pendiente |

---

## Licencia

MIT
