import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { createDarajaRouter } from './routes/daraja.js';
import { createCallbackQueue } from './queue/callbacks.js';

const app = express();
const prisma = new PrismaClient();
const callbacks = createCallbackQueue(prisma);

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/v1', createDarajaRouter(prisma, callbacks));
callbacks;

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const frontendDirectory = resolve(currentDirectory, '../../frontend/dist');
if (existsSync(frontendDirectory)) {
  app.use(express.static(frontendDirectory));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') return next();
    res.sendFile(resolve(frontendDirectory, 'index.html'));
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);

  if (error && typeof error === 'object' && 'issues' in error) {
    const zodError = error as { issues: Array<{ path: Array<string | number>; message: string }> };
    res.status(400).json({
      error: zodError.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') || 'Invalid request'
    });
    return;
  }

  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as { response?: { status?: number; data?: unknown } };
    const upstreamStatus = axiosError.response?.status;
    const upstreamData = axiosError.response?.data;
    res.status(upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 600 ? upstreamStatus : 502).json({
      error: 'Daraja rejected or could not process the request',
      darajaStatus: upstreamStatus,
      darajaResponse: upstreamData
    });
    return;
  }

  res.status(400).json({
    error: error instanceof Error ? error.message : 'Invalid request'
  });
});

const server = app.listen(env.PORT, () => {
  console.log(`Daraja engine listening on port ${env.PORT}`);
});

async function shutdown() {
  server.close(async () => {
    await callbacks.worker.close();
    await callbacks.queue.close();
    await callbacks.connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
