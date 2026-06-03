import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import inventoryRoutes from './routes/inventoryRoutes';

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Ejecutar conexión a la base de datos
connectDB();

// Middlewares
app.use(cors()); // Permite que tu frontend de Vite se conecte sin errores
app.use(express.json()); // Permite leer JSON en req.body

// Rutas
app.use('/api/inventory', inventoryRoutes);

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});