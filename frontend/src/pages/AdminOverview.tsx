import { FormEvent, useEffect, useState } from 'react';

const apiFetch = (path: string, init: RequestInit = {}) => {
  const token = window.sessionStorage.getItem('daraja_admin_token') ?? '';
  return fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}), Authorization: `Bearer ${token}` }
  });
};

export default function AdminOverview() {
  const [tab, setTab] = useState<'collect' | 'payout' | 'status'>('collect');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [collect, setCollect] = useState({ phone: '254', amount: '', reference: 'TILL' });
  const [payout, setPayout] = useState({ phone: '254', amount: '', remarks: 'Payout' });
  const [checkoutId, setCheckoutId] = useState('');

  useEffect(() => {
    if (!window.sessionStorage.getItem('daraja_admin_token')) {
      const token = window.prompt('Enter your Daraja admin API token');
      if (token?.trim()) window.sessionStorage.setItem('daraja_admin_token', token.trim());
    }
  }, []);

  const notify = (text: string) => setMessage(text);

  const submitJson = async (path: string, body: object) => {
    setLoading(true);
    setMessage('');
    try {
      const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.darajaResponse?.errorMessage || 'Request failed');
      notify(data.CustomerMessage || data.ResponseDescription || data.ResultDesc || 'Daraja accepted the request');
      return data;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not reach Daraja');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const collectPayment = (event: FormEvent) => {
    event.preventDefault();
    void submitJson('/api/v1/checkout/stk', {
      phoneNumber: collect.phone,
      amount: Number(collect.amount),
      accountReference: collect.reference,
      transactionDesc: 'Payment'
    }).then((data) => {
      if (data?.CheckoutRequestID) setCheckoutId(data.CheckoutRequestID);
    });
  };

  const sendPayout = (event: FormEvent) => {
    event.preventDefault();
    void submitJson('/api/v1/b2c/pay', {
      phoneNumber: payout.phone,
      amount: Number(payout.amount),
      remarks: payout.remarks
    });
  };

  const checkStatus = (event: FormEvent) => {
    event.preventDefault();
    void submitJson('/api/v1/checkout/query', { checkoutRequestId: checkoutId });
  };

  const checkBalance = () => { void submitJson('/api/v1/account/balance', {}); };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <section className="mx-auto max-w-xl">
        <header className="mb-6 flex items-center justify-between">
          <div><p className="text-sm text-emerald-400">Daraja Till</p><h1 className="text-2xl font-bold">M-Pesa Payments</h1></div>
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-400">No database</span>
        </header>

        <nav className="mb-5 grid grid-cols-3 rounded-xl border border-slate-800 bg-slate-900 p-1">
          {(['collect', 'payout', 'status'] as const).map((item) => (
            <button key={item} onClick={() => setTab(item)} className={`rounded-lg px-3 py-2 text-sm capitalize ${tab === item ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>{item === 'collect' ? 'Collect' : item === 'payout' ? 'Pay B2C' : 'Status'}</button>
          ))}
        </nav>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
          {tab === 'collect' && (
            <form onSubmit={collectPayment} className="space-y-4">
              <h2 className="text-lg font-semibold">Request payment</h2>
              <label className="block text-sm">Phone number<input required value={collect.phone} onChange={(e) => setCollect({ ...collect, phone: e.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3" placeholder="254712345678" /></label>
              <label className="block text-sm">Amount (KES)<input required type="number" min="1" value={collect.amount} onChange={(e) => setCollect({ ...collect, amount: e.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3" placeholder="100" /></label>
              <label className="block text-sm">Till reference<input required maxLength={12} value={collect.reference} onChange={(e) => setCollect({ ...collect, reference: e.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3" /></label>
              <button disabled={loading} className="w-full rounded-lg bg-emerald-600 py-3 font-semibold disabled:opacity-60">{loading ? 'Sending…' : 'Send M-Pesa prompt'}</button>
            </form>
          )}

          {tab === 'payout' && (
            <form onSubmit={sendPayout} className="space-y-4">
              <h2 className="text-lg font-semibold">Pay a customer (B2C)</h2>
              <label className="block text-sm">Phone number<input required value={payout.phone} onChange={(e) => setPayout({ ...payout, phone: e.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3" placeholder="254712345678" /></label>
              <label className="block text-sm">Amount (KES)<input required type="number" min="1" value={payout.amount} onChange={(e) => setPayout({ ...payout, amount: e.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3" placeholder="500" /></label>
              <label className="block text-sm">Remarks<input maxLength={100} value={payout.remarks} onChange={(e) => setPayout({ ...payout, remarks: e.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3" /></label>
              <button disabled={loading} className="w-full rounded-lg bg-amber-500 py-3 font-semibold text-slate-950 disabled:opacity-60">{loading ? 'Sending…' : 'Send B2C payout'}</button>
            </form>
          )}

          {tab === 'status' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Check status</h2>
              <form onSubmit={checkStatus} className="space-y-4"><label className="block text-sm">Checkout request ID<input required value={checkoutId} onChange={(e) => setCheckoutId(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3" /></label><button disabled={loading} className="w-full rounded-lg bg-sky-600 py-3 font-semibold">Check STK status</button></form>
              <button onClick={checkBalance} disabled={loading} className="w-full rounded-lg border border-slate-700 py-3 font-semibold text-slate-300">Check M-Pesa balance</button>
            </div>
          )}
        </div>

        {message && <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm">{message}</div>}
      </section>
    </main>
  );
}
