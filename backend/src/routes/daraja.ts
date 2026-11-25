import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { DarajaService } from '../services/daraja.js';
import { requireAdmin, validateDarajaSignature } from '../middleware/security.js';

export function createDarajaRouter(prisma: PrismaClient, callbackQueue?: { queue: { add: (name: string, data: unknown) => Promise<unknown> } }) {
  const router = Router();
  const daraja = new DarajaService();

  router.post('/checkout/stk', requireAdmin('admin'), async (req, res, next) => {
    try {
      const input = z.object({
        phoneNumber: z.string().transform((value) => {
          const digits = value.replace(/\D/g, '');
          if (/^2547\d{8}$/.test(digits)) return digits;
          if (/^07\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
          if (/^7\d{8}$/.test(digits)) return `254${digits}`;
          throw new Error('Phone number must be a valid Kenyan mobile number, for example 254712345678');
        }),
        amount: z.coerce.number().positive().max(150000),
        accountReference: z.string().trim().min(1).max(12),
        transactionDesc: z.string().max(13).optional()
      }).parse(req.body);

      const response = await daraja.initiateStkPush(input);
      try {
        await prisma.transaction.create({
          data: {
            checkoutRequestId: response.CheckoutRequestID,
            merchantRequestId: response.MerchantRequestID,
            type: 'STK_PUSH',
            status: 'PENDING',
            amount: input.amount,
            phoneNumber: input.phoneNumber,
            accountReference: input.accountReference,
            transactionDesc: input.transactionDesc
          }
        });
      } catch (databaseError) {
        console.warn('STK response received, but transaction persistence is unavailable', databaseError);
      }
      res.status(202).json(response);
    } catch (error) { next(error); }
  });

  router.post('/callback/stk', validateDarajaSignature, async (req, res) => {
    const payload = req.body;
    const callback = payload?.Body?.stkCallback;
    const webhook = await prisma.webhookLog.create({
      data: { source: 'safaricom', eventType: 'stk.callback', payload, signatureValid: true, receivedAt: new Date() }
    });

    if (!callback?.CheckoutRequestID) {
      res.status(400).json({ received: false });
      return;
    }

    const isSuccess = callback.ResultCode === 0;
    const resultDesc = callback.ResultCode === 2029
      ? 'Daraja accepted the STK request but M-Pesa could not deliver the prompt. Verify that shortcode 1436013 is active for STK Push and that the phone is enrolled in M-Pesa.'
      : callback.ResultDesc;

    const items = callback.CallbackMetadata?.Item ?? [];
    const receipt = items.find((item: { Name: string }) => item.Name === 'MpesaReceiptNumber')?.Value;

    await prisma.transaction.updateMany({
      where: { checkoutRequestId: callback.CheckoutRequestID },
      data: {
        status: isSuccess ? 'SUCCESS' : 'FAILED',
        receiptNumber: receipt ? String(receipt) : undefined,
        resultCode: callback.ResultCode,
        resultDesc,
        metadata: payload
      }
    });

    if (callbackQueue) {
      callbackQueue.queue.add('daraja.callback.process', { webhookId: webhook.id });
    }

    res.status(200).json({ received: true });
  });

  router.post('/checkout/query', requireAdmin('admin'), async (req, res, next) => {
    try {
      const input = z.object({ checkoutRequestId: z.string().min(1) }).parse(req.body);
      const response = await daraja.queryStkPush(input.checkoutRequestId);

      const resultCode = typeof response.ResultCode === 'number'
        ? response.ResultCode
        : (typeof response.ResultCode === 'string' ? Number(response.ResultCode) : null);
      if (resultCode !== null) {
        await prisma.transaction.updateMany({
          where: { checkoutRequestId: input.checkoutRequestId },
          data: {
            status: resultCode === 0 ? 'SUCCESS' : (resultCode === 499 ? 'PENDING' : 'FAILED'),
            resultCode,
            resultDesc: response.ResultDesc ?? response.errorMessage
          }
        });
      }

      res.json(response);
    } catch (error) { next(error); }
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

  router.post('/c2b/simulate', requireAdmin('admin'), async (req, res, next) => {
    try {
      const input = z.object({ amount: z.number().positive(), phoneNumber: z.string(), billRefNumber: z.string().min(1), accountReference: z.string().optional() }).parse(req.body);
      res.json(await daraja.simulateC2b(input));
    } catch (error) { next(error); }
  });

  router.post('/b2c/pay', requireAdmin('admin'), async (req, res, next) => {
    try {
      const input = z.object({ phoneNumber: z.string(), amount: z.number().positive(), remarks: z.string().optional(), occasion: z.string().optional() }).parse(req.body);
      const response = await daraja.initiateB2c(input);
      await prisma.transaction.create({ data: { conversationId: response.ConversationID, type: 'B2C', status: 'PENDING', amount: input.amount, phoneNumber: input.phoneNumber, transactionDesc: input.remarks } }).catch(() => undefined);
      res.status(202).json(response);
    } catch (error) { next(error); }
  });

  router.post('/b2b/pay', requireAdmin('admin'), async (req, res, next) => {
    try {
      const input = z.object({ amount: z.number().positive(), partyB: z.string().min(1), accountReference: z.string().min(1), requester: z.string().optional(), commandId: z.enum(['BusinessPayBill', 'BusinessBuyGoods']).optional() }).parse(req.body);
      const response = await daraja.initiateB2b(input);
      await prisma.transaction.create({ data: { conversationId: response.ConversationID, type: 'B2B', status: 'PENDING', amount: input.amount, accountReference: input.accountReference } }).catch(() => undefined);
      res.status(202).json(response);
    } catch (error) { next(error); }
  });

  router.post('/invoices', requireAdmin('admin'), async (req, res, next) => {
    try {
      const input = z.object({ invoiceNumber: z.string().min(1), customerName: z.string().min(1), customerNumber: z.string().min(1), amount: z.number().positive(), dueDate: z.string(), description: z.string().optional() }).parse(req.body);
      const invoice = await prisma.invoice.create({ data: { invoiceNumber: input.invoiceNumber, customerName: input.customerName, customerNumber: input.customerNumber, amount: input.amount, dueDate: new Date(input.dueDate), description: input.description, status: 'ISSUED' } });
      const darajaResponse = await daraja.createInvoice({ phoneNumber: input.customerNumber, amount: input.amount, externalInvoiceId: invoice.id, dueDate: input.dueDate, description: input.description ?? 'Invoice payment' });
      res.status(202).json({ invoice, daraja: darajaResponse });
    } catch (error) { next(error); }
  });

  router.post('/account/balance', requireAdmin('admin'), async (_req, res, next) => {
    try { res.status(202).json(await daraja.queryAccountBalance()); }
    catch (error) { next(error); }
  });

  router.get('/dashboard/summary', requireAdmin('auditor'), async (_req, res) => {
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const [collections, payouts, pendingInvoices, invoicesAmount, latestBalance, recent] = await Promise.all([
        prisma.transaction.aggregate({
          _sum: { amount: true },
          where: { createdAt: { gte: start }, status: 'SUCCESS', type: { in: ['STK_PUSH', 'C2B'] } }
        }),
        prisma.transaction.aggregate({
          _sum: { amount: true },
          where: { createdAt: { gte: start }, status: 'SUCCESS', type: { in: ['B2C', 'B2B', 'REVERSAL'] } }
        }),
        prisma.invoice.count({ where: { status: { in: ['ISSUED', 'OVERDUE'] } } }),
        prisma.invoice.aggregate({
          _sum: { amount: true },
          where: { status: { in: ['ISSUED', 'OVERDUE'] } }
        }),
        prisma.accountBalanceLog.findFirst({ orderBy: { queriedAt: 'desc' } }),
        prisma.transaction.findMany({ take: 20, orderBy: { createdAt: 'desc' } })
      ]);

      res.json({
        collectionsToday: Number(collections._sum.amount ?? 0),
        payoutsToday: Number(payouts._sum.amount ?? 0),
        pendingInvoices: pendingInvoices,
        pendingInvoiceAmount: Number(invoicesAmount._sum.amount ?? 0),
        accountBalance: latestBalance ? Number(latestBalance.balance) : null,
        recentTransactions: recent.map((tx) => ({
          id: tx.id,
          checkoutRequestId: tx.checkoutRequestId,
          receipt: tx.receiptNumber ?? '—',
          name: tx.phoneNumber ?? tx.accountReference ?? 'Unknown',
          amount: Number(tx.amount),
          method: tx.type === 'STK_PUSH' ? 'STK Push' : tx.type,
          status: tx.status === 'SUCCESS' ? 'Success' : tx.status === 'PENDING' ? 'Pending' : tx.status === 'FAILED' ? 'Failed' : tx.status,
          resultCode: tx.resultCode,
          resultDesc: tx.resultDesc,
          time: tx.createdAt
        }))
      });
    } catch (error) {
      console.error('Dashboard summary failed', error);
      res.status(503).json({ error: 'Database unavailable' });
    }
  });

  router.get('/dashboard/cashflow', requireAdmin('auditor'), async (_req, res) => {
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const transactions = await prisma.transaction.findMany({
        where: { createdAt: { gte: start }, status: 'SUCCESS' },
        select: { amount: true, type: true, createdAt: true }
      });
      const buckets = new Map<number, { collections: number; payouts: number }>();
      for (let hour = 0; hour < 24; hour += 2) buckets.set(hour, { collections: 0, payouts: 0 });
      for (const tx of transactions) {
        const hour = Math.floor(tx.createdAt.getHours() / 2) * 2;
        const bucket = buckets.get(hour)!;
        if (tx.type === 'STK_PUSH' || tx.type === 'C2B') bucket.collections += Number(tx.amount);
        if (tx.type === 'B2C' || tx.type === 'B2B' || tx.type === 'REVERSAL') bucket.payouts += Number(tx.amount);
      }
      res.json({ data: [...buckets.entries()].map(([hour, value]) => ({
        time: `${String(hour).padStart(2, '0')}:00`, ...value
      })).filter((bucket) => bucket.collections > 0 || bucket.payouts > 0) });
    } catch (error) {
      console.error('Cashflow query failed', error);
      res.status(503).json({ error: 'Database unavailable' });
    }
  });

  router.get('/transactions', requireAdmin('auditor'), async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page ?? 1));
      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const status = typeof req.query.status === 'string' ? req.query.status : '';

      const where: Record<string, unknown> = {};
      if (search) {
        where.OR = [
          { receiptNumber: { contains: search, mode: 'insensitive' } },
          { phoneNumber: { contains: search } },
          { accountReference: { contains: search, mode: 'insensitive' } }
        ];
      }
      if (['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REVERSED'].includes(status)) where.status = status;

      const [items, total] = await Promise.all([
        prisma.transaction.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
        prisma.transaction.count({ where })
      ]);

      res.json({
        items: items.map((tx) => ({
          id: tx.id, receipt: tx.receiptNumber ?? '—', name: tx.phoneNumber ?? tx.accountReference ?? 'Unknown',
          amount: Number(tx.amount), method: tx.type === 'STK_PUSH' ? 'STK Push' : tx.type,
          status: tx.status === 'SUCCESS' ? 'Success' : tx.status === 'PENDING' ? 'Pending' : tx.status === 'FAILED' ? 'Failed' : tx.status,
          time: tx.createdAt
        })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      });
    } catch (error) {
      console.error('Transaction listing failed', error);
      res.status(503).json({ error: 'Database unavailable' });
    }
  });

  router.post('/callback/c2b/validation', validateDarajaSignature, async (req, res) => {
    const payload = req.body;
    await prisma.webhookLog.create({ data: { source: 'safaricom', eventType: 'c2b.validation', signatureValid: true, payload } });
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  router.post('/callback/c2b/confirmation', validateDarajaSignature, async (req, res) => {
    const payload = req.body;
    const webhook = await prisma.webhookLog.create({ data: { source: 'safaricom', eventType: 'c2b.confirmation', signatureValid: true, payload } });
    const receipt = payload.TransID ? String(payload.TransID) : null;
    await prisma.transaction.create({
      data: {
        receiptNumber: receipt,
        conversationId: payload.TransID ? String(payload.TransID) : undefined,
        type: 'C2B',
        status: 'SUCCESS',
        amount: Number(payload.TransAmount ?? 0),
        phoneNumber: payload.MSISDN ? String(payload.MSISDN) : null,
        accountReference: payload.BillRefNumber ? String(payload.BillRefNumber) : null,
        metadata: payload
      }
    }).catch((error) => console.warn('C2B transaction persistence failed', error));
    if (callbackQueue) await callbackQueue.queue.add('daraja.c2b.process', { webhookId: webhook.id });
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  router.post('/callback/result', validateDarajaSignature, async (req, res) => {
    const payload = req.body;
    const webhook = await prisma.webhookLog.create({ data: { source: 'safaricom', eventType: 'result', signatureValid: true, payload } });
    const result = payload?.Result;
    const conversationId = result?.ConversationID ? String(result.ConversationID) : undefined;
    const receipt = result?.ResultParameters?.ResultParameter?.find((item: { Key: string }) => item.Key === 'TransactionReceipt')?.Value;

    if (conversationId) {
      await prisma.transaction.updateMany({
        where: { conversationId },
        data: {
          status: result?.ResultCode === 0 ? 'SUCCESS' : 'FAILED',
          receiptNumber: receipt ? String(receipt) : undefined,
          resultCode: result?.ResultCode,
          resultDesc: result?.ResultDesc,
          metadata: payload
        }
      });
    }

    const balanceItems = result?.ResultParameters?.ResultParameter;
    if (Array.isArray(balanceItems)) {
      const balanceItem = balanceItems.find((item: { Key: string }) => item.Key === 'AccountBalance');
      if (balanceItem?.Value) {
        const match = String(balanceItem.Value).match(/([0-9]+(?:\.[0-9]+)?)/);
        if (match) await prisma.accountBalanceLog.create({ data: { balance: match[1], resultCode: result?.ResultCode, resultDesc: result?.ResultDesc, rawResponse: payload } });
      }
    }
    if (callbackQueue) await callbackQueue.queue.add('daraja.result.process', { webhookId: webhook.id });
    res.status(200).json({ received: true });
  });

  router.post('/callback/timeout', validateDarajaSignature, async (req, res) => {
    const payload = req.body;
    await prisma.webhookLog.create({ data: { source: 'safaricom', eventType: 'timeout', signatureValid: true, payload } });
    res.status(200).json({ received: true });
  });

  router.post('/callback/b2c/result', validateDarajaSignature, async (req, res) => {
    const payload = req.body;
    const webhook = await prisma.webhookLog.create({ data: { source: 'safaricom', eventType: 'b2c.result', signatureValid: true, payload } });
    const result = payload?.Result;
    const conversationId = result?.ConversationID ? String(result.ConversationID) : undefined;
    const parameters = result?.ResultParameters?.ResultParameter ?? [];
    const receipt = parameters.find((item: { Key: string }) => item.Key === 'TransactionReceipt')?.Value;
    if (conversationId) await prisma.transaction.updateMany({ where: { conversationId }, data: { status: result?.ResultCode === 0 ? 'SUCCESS' : 'FAILED', receiptNumber: receipt ? String(receipt) : undefined, resultCode: result?.ResultCode, resultDesc: result?.ResultDesc, metadata: payload } });
    if (callbackQueue) await callbackQueue.queue.add('daraja.b2c.process', { webhookId: webhook.id });
    res.status(200).json({ received: true });
  });

  router.post('/callback/b2c/timeout', validateDarajaSignature, async (req, res) => {
    await prisma.webhookLog.create({ data: { source: 'safaricom', eventType: 'b2c.timeout', signatureValid: true, payload: req.body } });
    res.status(200).json({ received: true });
  });

  return router;
}
