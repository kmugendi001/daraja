import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

export function requireAdmin(role: 'admin' | 'auditor' = 'admin') {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const adminToken = env.ADMIN_API_TOKEN;
    const auditorToken = env.AUDITOR_API_TOKEN;
    const allowed = role === 'auditor'
      ? Boolean(auditorToken && token === auditorToken) || Boolean(adminToken && token === adminToken)
      : Boolean(adminToken && token === adminToken);

    if (!allowed) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}

export function validateDarajaSignature(req: Request, res: Response, next: NextFunction) {
  if (!env.DARAJA_CALLBACK_SECRET) { next(); return; }

  const signature = req.header('x-daraja-signature') ?? req.header('x-signature') ?? '';
  const supplied = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const digest = crypto.createHmac('sha256', env.DARAJA_CALLBACK_SECRET)
    .update(JSON.stringify(req.body)).digest('hex');

  const suppliedBuffer = Buffer.from(supplied);
  const digestBuffer = Buffer.from(digest);
  if (suppliedBuffer.length !== digestBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, digestBuffer)) {
    res.status(401).json({ error: 'Invalid callback signature' });
    return;
  }
  next();
}
