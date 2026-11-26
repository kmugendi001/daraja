import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export function createCallbackQueue(prisma: PrismaClient) {
  if (process.env.VERCEL) {
    return {
      queue: { add: async () => undefined, close: async () => undefined },
      worker: { close: async () => undefined },
      connection: { quit: async () => undefined }
    };
  }

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue('daraja-callbacks', { connection });

  const worker = new Worker('daraja-callbacks', async (job: Job) => {
    const webhookId = job.data.webhookId as string;
    try {
      const webhook = await prisma.webhookLog.findUnique({ where: { id: webhookId } });
      if (!webhook) throw new Error('Webhook log not found');

      const payload = webhook.payload as any;
      const callback = payload?.Body?.stkCallback;
      if (callback?.CheckoutRequestID) {
        const isSuccess = callback.ResultCode === 0;
        const items = callback.CallbackMetadata?.Item ?? [];
        const receipt = items.find((item: { Name: string }) => item.Name === 'MpesaReceiptNumber')?.Value;
        const resultDesc = callback.ResultCode === 2029
          ? 'Daraja accepted the STK request but M-Pesa could not deliver the prompt. Verify that shortcode 1436013 is active for STK Push and that the phone is enrolled in M-Pesa.'
          : callback.ResultDesc;
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
      }
      await prisma.webhookLog.update({ where: { id: webhookId }, data: { processed: true, processingError: null } });
    } catch (error) {
      await prisma.webhookLog.update({ where: { id: webhookId }, data: { processingError: error instanceof Error ? error.message : 'Unknown error' } });
      throw error;
    }
  }, { connection, concurrency: 4 });

  return { queue, worker, connection };
}
