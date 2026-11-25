export type Transaction = {
  id: string;
  receiptNumber: string | null;
  phoneNumber: string | null;
  accountReference: string | null;
  amount: unknown;
  type: 'STK_PUSH' | 'C2B' | 'B2C' | 'B2B' | 'REVERSAL';
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REVERSED';
  createdAt: Date;
};
