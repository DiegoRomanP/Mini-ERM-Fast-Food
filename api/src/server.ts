import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { buildApp } from './app.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;
const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

const app = buildApp();

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  app.log.info({ signal }, 'Recibida señal de cierre, apagando servidor...');

  const timeout = setTimeout(() => {
    app.log.error('Timeout de apagado alcanzado, forzando salida');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timeout.unref();

  try {
    await app.close();
    await prisma.$disconnect();
    clearTimeout(timeout);
    app.log.info('Servidor apagado correctamente');
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    app.log.error({ err: error }, 'Error durante el apagado');
    process.exit(1);
  }
}

for (const signal of SIGNALS) {
  process.on(signal, () => void shutdown(signal));
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error({ err: error }, 'Error al iniciar el servidor');
  await prisma.$disconnect();
  process.exit(1);
}
