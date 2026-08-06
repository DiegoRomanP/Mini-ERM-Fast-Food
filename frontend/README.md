<div align="center">
  <h1>Mini ERP — Frontend</h1>
  <p><strong>Interfaz de usuario para gestión de inventario y dashboard analítico</strong></p>

  ![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
  ![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
  ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
  ![Recharts](https://img.shields.io/badge/Recharts-FF6B6B?style=for-the-badge&logo=recharts&logoColor=white)
</div>

---

## Descripción

Frontend del Mini ERP construido con React 19 + TypeScript + Vite. Proporciona una interfaz moderna y responsiva para administrar el inventario, registrar órdenes, y visualizar analytics con gráficos interactivos y alertas predictivas de agotamiento de stock.

---

## Tecnologías

| Tecnología | Versión | Propósito |
|---|---|---|
| React | 19.2.6 | Biblioteca de UI |
| TypeScript | 6.0.2 | Tipado estático |
| Vite | 8.0.12 | Bundler y dev server |
| Tailwind CSS | 3.4.19 | Estilos utilitarios |
| Recharts | 3.8.1 | Gráficos interactivos |
| Axios | 1.17.0 | Cliente HTTP |

---

## Estructura

```
frontend/
├── src/
│   ├── components/
│   │   ├── AnalyticsDashboard.tsx  # Dashboard con gráficos y alertas predictivas
│   │   ├── ItemForm.tsx            # Formulario para crear/editar insumos
│   │   ├── Modal.tsx               # Modal reutilizable
│   │   ├── ProductTable.tsx        # Tabla de inventario con acciones CRUD
│   │   ├── SearchBar.tsx           # Búsqueda en tiempo real
│   │   └── Toast.tsx              # Sistema de notificaciones
│   ├── services/
│   │   └── api.ts                  # Cliente Axios (CRUD + analytics)
│   ├── types/
│   │   └── index.ts                # Interfaces compartidas
│   ├── App.tsx                     # Componente raíz
│   ├── main.tsx                    # Entry point
│   └── index.css                   # Estilos globales + Tailwind
├── public/
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── eslint.config.js
├── tsconfig.json
└── package.json
```

---

## Instalación

```bash
cd frontend
npm install
```

---

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Inicia servidor de desarrollo con HMR |
| `npm run build` | Compila TypeScript y empaqueta con Vite |
| `npm run lint` | Ejecuta ESLint en todo el proyecto |
| `npm run preview` | Previsualiza el build de producción |

---

## Dependencias: `overrides` de `es-toolkit` (NO ELIMINAR)

`package.json` contiene este bloque, que **no debe borrarse a la ligera**:

```json
"overrides": {
  "es-toolkit": "^1.50.0"
}
```

Como `package.json` no admite comentarios, la justificación vive aquí.

### Qué rompía

Sin el override, `npm run dev` **crasheaba antes de montar React**:

```
TypeError: require_isUnsafeProperty is not a function
```

Solo afectaba al servidor de desarrollo. `npm run build` (producción) **nunca** se vio afectado,
lo que hacía el fallo especialmente confuso de diagnosticar.

### Causa raíz

1. `recharts` importa subpaths profundos de `es-toolkit`, p. ej. `import get from 'es-toolkit/compat/get'`.
2. En **es-toolkit 1.47.0**, el campo `exports` para `./compat/*` **no tenía condición `import`**:
   solo `default` → `./compat/*.js`, que es un **shim CommonJS**
   (`module.exports = require('../dist/compat/object/get.js').get`).
3. Al resolverse a CJS, **Rolldown** (el pre-bundler de dependencias de Vite 8 — no es esbuild)
   aplica su transform CommonJS→ESM sobre `dist/compat/object/get.js`.
4. Ese archivo declara sus propias constantes con el prefijo `require_`
   (`const require_isUnsafeProperty = require(...)`), **exactamente el mismo prefijo** que Rolldown
   usa para nombrar sus funciones factory → **colisión de nombres**. El bundle quedaba así:

   ```js
   var require_isUnsafeProperty = require_isUnsafeProperty(); // se sombrea a sí misma
   ```

   El `var` hoistea el binding local como `undefined`, así que la llamada resuelve a la variable
   local en vez de a la factory → `is not a function`.

### Por qué el override lo arregla

**es-toolkit 1.50.0** añadió la condición `import` a `exports["./compat/*"]` → `./compat/*.mjs`.
Con ella `recharts` resuelve a **ESM real** y el transform CJS defectuoso nunca llega a ejecutarse.
`recharts` declara `es-toolkit: ^1.39.3`, así que 1.50.0 entra dentro de su rango semver: el
override sube la versión sin romper el contrato de la dependencia.

`vite.config.ts` **no necesitó cambios** y permanece en su estado original.

### Alternativas probadas y descartadas

| Intento | Resultado |
|---|---|
| `optimizeDeps.include: ['es-toolkit/compat']` | Mismo error |
| `optimizeDeps.exclude: ['es-toolkit']` | Falla distinta: `does not provide an export named 'default'` |

### Cuándo se podrá quitar

El override es un **parche temporal**. Se puede eliminar cuando ocurra cualquiera de estas dos cosas:

- `recharts` suba su rango mínimo de `es-toolkit` a **≥ 1.50.0** (entonces el override es redundante), **o**
- **Rolldown** corrija la colisión de nombres de su transform CJS→ESM con identificadores de
  usuario que empiecen por `require_`.

Al quitarlo, verificar **siempre con `npm run dev`** (no basta `npm run build`: el bug no se
manifiesta en producción). Tras cambiar versiones de dependencias puede hacer falta
`npm run dev -- --force` para invalidar la caché de `node_modules/.vite`.

---

## Componentes

### ProductTable

Tabla responsiva que lista los insumos con:
- Columnas: nombre, categoría, tipo, stock, unidad, acciones
- Resaltado automático en rojo para insumos con stock menor al mínimo
- Botones de editar (lápiz) y eliminar (papelera)
- Estado vacío cuando no hay resultados

### Modal

Componente reutilizable de diálogo modal:
- Fondo semitransparente con cierre al hacer clic fuera
- Animación suave con Tailwind
- Título configurable y botón de cierre

### ItemForm

Formulario para crear y editar insumos:
- Campos: nombre, tipo (select), categoría, stock, stock mínimo, unidad (select)
- Validación de campos requeridos
- Estado de envío con botón deshabilitado
- Compatible con creación y edición mediante prop `initialData`

### Toast

Sistema de notificaciones:
- Auto-dismiss después de 3 segundos
- Tipos: éxito (verde) y error (rojo)
- Cierre manual con botón

### SearchBar

Barra de búsqueda en tiempo real:
- Filtra el inventario localmente mientras el usuario escribe
- Diseño responsivo (ancho completo en mobile, mitad en desktop)

### AnalyticsDashboard

Panel analítico con:
- **4 tarjetas de resumen**: total insumos, stock bajo, críticos con &le;3 días, órdenes semanales
- **Alertas predictivas**: lista roja con mensajes como *"Atención: El pollo se agotará en aproximadamente 2 días"*
- **Gráfico de barras**: top 5 insumos con menor stock, comparando stock actual vs mínimo
- **Gráfico de torta**: distribución del inventario por categoría

---

## API (Consumo)

| Función | Método HTTP | Endpoint |
|---|---|---|
| `getInventory` | `GET` | `/api/inventory` |
| `createItem` | `POST` | `/api/inventory` |
| `updateItem` | `PUT` | `/api/inventory/:id` |
| `deleteItem` | `DELETE` | `/api/inventory/:id` |
| `getAnalytics` | `GET` | `/api/inventory/analytics` |

El cliente HTTP está configurado en `src/services/api.ts` usando Axios con tipado completo.

---

## Licencia

MIT
