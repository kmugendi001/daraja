import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env.js';

interface TokenState { token: string; expiresAt: number }

export class DarajaService {
  private tokenState?: TokenState;
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: env.DARAJA_API_BASE_URL,
      timeout: 20_000,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
    });
  }

  async getAccessToken(): Promise<string> {
    if (this.tokenState && this.tokenState.expiresAt > Date.now() + 60_000) {
      return this.tokenState.token;
    }

    const credentials = Buffer.from(`${env.DARAJA_CONSUMER_KEY}:${env.DARAJA_CONSUMER_SECRET}`).toString('base64');
    let data: { access_token?: string; expires_in?: string | number };
    try {
      const response = await this.http.get('/oauth/v1/generate', {
        params: { grant_type: 'client_credentials' },
        headers: { Authorization: `Basic ${credentials}` }
      });
      data = response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const details = error.response?.data;
        throw new Error(`Daraja OAuth failed with HTTP ${error.response?.status ?? 'network error'}${details ? `: ${typeof details === 'string' ? details : JSON.stringify(details)}` : ''}`);
      }
      throw error;
    }

    if (!data.access_token) throw new Error('Daraja OAuth returned no access token');
    const expiresIn = Number(data.expires_in ?? 3600);
    this.tokenState = { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return data.access_token;
  }

  private timestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  }

  private normalizePhone(phoneNumber: string): string {
    const digits = phoneNumber.replace(/\D/g, '');
    if (/^2547\d{8}$/.test(digits)) return digits;
    if (/^07\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
    if (/^7\d{8}$/.test(digits)) return `254${digits}`;
    throw new Error('Phone number must be a valid Kenyan mobile number, for example 254712345678');
  }

  async initiateStkPush(input: { phoneNumber: string; amount: number; accountReference: string; transactionDesc?: string }) {
    input.phoneNumber = this.normalizePhone(input.phoneNumber);
    if (!Number.isFinite(input.amount) || input.amount < 1) throw new Error('Amount must be greater than zero');
    if (!env.DARAJA_PASSKEY) throw new Error('DARAJA_PASSKEY is required for STK Push');

    const timestamp = this.timestamp();
    const password = Buffer.from(`${env.DARAJA_SHORTCODE}${env.DARAJA_PASSKEY}${timestamp}`).toString('base64');
    const token = await this.getAccessToken();

    const { data } = await this.http.post('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: env.DARAJA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: env.DARAJA_STK_TRANSACTION_TYPE,
      Amount: Math.round(input.amount),
      PartyA: input.phoneNumber,
      PartyB: env.DARAJA_SHORTCODE,
      PhoneNumber: input.phoneNumber,
      CallBackURL: env.DARAJA_CALLBACK_URL,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: (input.transactionDesc ?? 'Payment').slice(0, 13)
    }, { headers: { Authorization: `Bearer ${token}` } });

    return data;
  }

  async queryStkPush(checkoutRequestId: string) {
    if (!env.DARAJA_PASSKEY) throw new Error('DARAJA_PASSKEY is required for STK query');
    const timestamp = this.timestamp();
    const password = Buffer.from(`${env.DARAJA_SHORTCODE}${env.DARAJA_PASSKEY}${timestamp}`).toString('base64');
    const token = await this.getAccessToken();
    const { data } = await this.http.post('/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: env.DARAJA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId
    }, { headers: { Authorization: `Bearer ${token}` } });
    return data;
  }

  async registerC2bUrls(input: { shortCode?: string; responseType?: 'Completed' | 'Cancelled'; confirmationUrl: string; validationUrl: string }) {
    const token = await this.getAccessToken();
    const { data } = await this.http.post('/mpesa/c2b/v1/registerurl', {
      ShortCode: input.shortCode ?? env.DARAJA_SHORTCODE,
      ResponseType: input.responseType ?? 'Completed',
      ConfirmationURL: input.confirmationUrl,
      ValidationURL: input.validationUrl
    }, { headers: { Authorization: `Bearer ${token}` } });
    return data;
  }

  async simulateC2b(input: { amount: number; phoneNumber: string; billRefNumber: string; accountReference?: string; shortCode?: string }) {
    input.phoneNumber = this.normalizePhone(input.phoneNumber);
    const token = await this.getAccessToken();
    const { data } = await this.http.post('/mpesa/c2b/v1/simulate', {
      ShortCode: input.shortCode ?? env.DARAJA_SHORTCODE,
      CommandID: 'CustomerPayBillOnline',
      Amount: Math.round(input.amount),
      Msisdn: input.phoneNumber,
      BillRefNumber: input.billRefNumber,
      KYCInfo: input.accountReference ? `AccountReference=${input.accountReference}` : undefined
    }, { headers: { Authorization: `Bearer ${token}` } });
    return data;
  }

  private initiatorFields() {
    if (!env.DARAJA_INITIATOR_NAME || !env.DARAJA_SECURITY_CREDENTIAL) {
      throw new Error('Daraja initiator name and encrypted security credential are required');
    }
    return { InitiatorName: env.DARAJA_INITIATOR_NAME, SecurityCredential: env.DARAJA_SECURITY_CREDENTIAL };
  }

  async initiateB2c(input: { phoneNumber: string; amount: number; remarks?: string; occasion?: string }) {
    input.phoneNumber = this.normalizePhone(input.phoneNumber);
    const token = await this.getAccessToken();
    const { data } = await this.http.post('/mpesa/b2c/v1/paymentrequest', {
      OriginatorConversationID: `B2C-${Date.now()}`,
      InitiatorName: this.initiatorFields().InitiatorName,
      SecurityCredential: this.initiatorFields().SecurityCredential,
      CommandID: 'BusinessPayment',
      Amount: Math.round(input.amount),
      PartyA: env.DARAJA_SHORTCODE,
      PartyB: input.phoneNumber,
      Remarks: (input.remarks ?? 'Payout').slice(0, 100),
      QueueTimeOutURL: env.DARAJA_B2C_TIMEOUT_URL || env.DARAJA_TIMEOUT_URL,
      ResultURL: env.DARAJA_B2C_RESULT_URL || env.DARAJA_RESULT_URL,
      Occasion: (input.occasion ?? '').slice(0, 100)
    }, { headers: { Authorization: `Bearer ${token}` } });
    return data;
  }

  async initiateB2b(input: { amount: number; partyB: string; accountReference: string; requester?: string; commandId?: 'BusinessPayBill' | 'BusinessBuyGoods' }) {
    const token = await this.getAccessToken();
    const { data } = await this.http.post('/mpesa/b2b/v1/paymentrequest', {
      Initiator: this.initiatorFields().InitiatorName,
      SecurityCredential: this.initiatorFields().SecurityCredential,
      CommandID: input.commandId ?? 'BusinessPayBill',
      SenderIdentifierType: '4',
      RecieverIdentifierType: '4',
      Amount: Math.round(input.amount),
      PartyA: env.DARAJA_SHORTCODE,
      PartyB: input.partyB,
      AccountReference: input.accountReference.slice(0, 13),
      Remarks: 'Business payment',
      QueueTimeOutURL: env.DARAJA_TIMEOUT_URL,
      ResultURL: env.DARAJA_RESULT_URL,
      Requester: input.requester
    }, { headers: { Authorization: `Bearer ${token}` } });
    return data;
  }

  async queryAccountBalance() {
    const token = await this.getAccessToken();
    const { data } = await this.http.post('/mpesa/accountbalance/v1/query', {
      Initiator: this.initiatorFields().InitiatorName,
      SecurityCredential: this.initiatorFields().SecurityCredential,
      CommandID: 'AccountBalance',
      PartyA: env.DARAJA_SHORTCODE,
      IdentifierType: '4',
      Remarks: 'Balance query',
      QueueTimeOutURL: env.DARAJA_TIMEOUT_URL,
      ResultURL: env.DARAJA_RESULT_URL
    }, { headers: { Authorization: `Bearer ${token}` } });
    return data;
  }

  async createInvoice(input: { phoneNumber: string; amount: number; externalInvoiceId: string; dueDate: string; description: string }) {
    const token = await this.getAccessToken();
    const timestamp = this.timestamp();
    const { data } = await this.http.post('/v1/b2b/invoice', {
      PhoneNumber: input.phoneNumber,
      Amount: Math.round(input.amount),
      ExternalInvoiceId: input.externalInvoiceId,
      DueDate: input.dueDate,
      Description: input.description,
      ShortCode: env.DARAJA_SHORTCODE,
      Timestamp: timestamp
    }, { headers: { Authorization: `Bearer ${token}` } });
    return data;
  }
}
