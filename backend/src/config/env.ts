import 'dotenv/config';
import { z } from 'zod';

const optionalUrl = z.string().url().optional().or(z.literal(''));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DARAJA_CONSUMER_KEY: z.string().min(1),
  DARAJA_CONSUMER_SECRET: z.string().min(1),
  DARAJA_SHORTCODE: z.string().min(1),
  DARAJA_STK_TRANSACTION_TYPE: z.enum(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']).default('CustomerPayBillOnline'),
  DARAJA_PASSKEY: z.string().default(''),
  DARAJA_CALLBACK_URL: z.string().url(),
  DARAJA_C2B_VALIDATION_URL: optionalUrl,
  DARAJA_C2B_CONFIRMATION_URL: optionalUrl,
  DARAJA_RESULT_URL: optionalUrl,
  DARAJA_TIMEOUT_URL: optionalUrl,
  DARAJA_B2C_RESULT_URL: optionalUrl,
  DARAJA_B2C_TIMEOUT_URL: optionalUrl,
  DARAJA_API_BASE_URL: z.string().url().default('https://api.safaricom.co.ke'),
  DARAJA_CALLBACK_SECRET: z.string().default(''),
  DARAJA_INITIATOR_NAME: z.string().default(''),
  DARAJA_SECURITY_CREDENTIAL: z.string().default(''),
  DARAJA_ENVIRONMENT: z.enum(['sandbox', 'production']).default('production'),
  ADMIN_API_TOKEN: z.string().default(''),
  AUDITOR_API_TOKEN: z.string().default('')
});

const parsed = schema.parse(process.env);

if (parsed.NODE_ENV === 'production' && parsed.DARAJA_API_BASE_URL !== 'https://api.safaricom.co.ke') {
  throw new Error('Production Daraja API base URL must be https://api.safaricom.co.ke');
}

if (parsed.NODE_ENV === 'production') {
  if (!parsed.DARAJA_CALLBACK_URL.startsWith('https://')) throw new Error('Production Daraja callbacks must use HTTPS');
}

export const env = parsed;
