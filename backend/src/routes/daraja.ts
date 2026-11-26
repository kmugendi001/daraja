import { Router } from 'express';
import { z } from 'zod';
import { DarajaService } from '../services/daraja.js';
import { requireAdmin, validateDarajaSignature } from '../middleware/security.js';

export function createDarajaRouter() {
  const router = Router();
  const daraja = new DarajaService();

  router.post('/checkout/stk', requireAdmin('admin'), async (req, res, next) => {
    try {
      const input = z.object({
        phoneNumber: z.string().min(9),
        amount: z.coerce.number().positive().max(150000),
        accountReference: z.string().trim().min(1).max(12),
        transactionDesc: z.string().max(13).optional()
      }).parse(req.body);
      res.status(202).json(await daraja.initiateStkPush(input));
    } catch (error) { next(error); }
  });

  router.post('/checkout/query', requireAdmin('admin'), async (req, res, next) => {
    try {
      const input = z.object({ checkoutRequestId: z.string().min(1) }).parse(req.body);
      res.json(await daraja.queryStkPush(input.checkoutRequestId));
    } catch (error) { next(error); }
  });

  router.post('/b2c/pay', requireAdmin('admin'), async (req, res, next) => {
    try {
      const input = z.object({
        phoneNumber: z.string().min(9),
        amount: z.coerce.number().positive().max(150000),
        remarks: z.string().max(100).optional(),
        occasion: z.string().max(100).optional()
      }).parse(req.body);
      res.status(202).json(await daraja.initiateB2c(input));
    } catch (error) { next(error); }
  });

  router.post('/account/balance', requireAdmin('admin'), async (_req, res, next) => {
    try { res.status(202).json(await daraja.queryAccountBalance()); }
    catch (error) { next(error); }
  });

  router.post('/c2b/register', requireAdmin('admin'), async (req, res, next) => {
    try {
      const input = z.object({
        shortCode: z.string().optional(),
        responseType: z.enum(['Completed', 'Cancelled']).optional(),
        confirmationUrl: z.string().url().optional(),
        validationUrl: z.string().url().optional()
      }).parse(req.body);
      res.json(await daraja.registerC2bUrls({
        ...input,
        confirmationUrl: input.confirmationUrl ?? process.env.DARAJA_C2B_CONFIRMATION_URL!,
        validationUrl: input.validationUrl ?? process.env.DARAJA_C2B_VALIDATION_URL!
      }));
    } catch (error) { next(error); }
  });

  router.post('/callback/stk', validateDarajaSignature, (req, res) => {
    res.status(200).json({ received: true, callback: req.body?.Body?.stkCallback ?? null });
  });

  router.post('/callback/c2b/confirmation', validateDarajaSignature, (req, res) => {
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  router.post('/callback/c2b/validation', validateDarajaSignature, (_req, res) => {
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  return router;
}
