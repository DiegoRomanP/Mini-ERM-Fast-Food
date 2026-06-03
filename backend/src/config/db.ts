import mongoose from 'mongoose';

export const connectDB = async (): Promise<void> => {
  try {
    // La URI vendrá de tus variables de entorno para mantenerla segura
    const conn = await mongoose.connect(process.env.MONGO_URI as string);
    console.log(`MongoDB Conectado: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error de conexión a MongoDB: ${error}`);
    process.exit(1); // Detiene el servidor si falla la base de datos
  }
};