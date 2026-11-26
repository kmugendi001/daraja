import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { createDarajaRouter } from './routes/daraja.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/v1', createDarajaRouter());

app.get('/health', (_req, res) => res.json({ status: 'ok', database: 'not-required' }));

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
    res.status(400).json({ error: zodError.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') || 'Invalid request' });
    return;
  }
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as { response?: { status?: number; data?: unknown } };
    res.status(502).json({ error: 'Daraja rejected or could not process the request', darajaResponse: axiosError.response?.data });
    return;
  }
  res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
});

export default app;
export { app };

if (!process.env.VERCEL) {
  const server = app.listen(env.PORT, () => console.log(`Daraja till listening on port ${env.PORT}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
