import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, BarChart3, CreditCard, Landmark, Menu,
  RefreshCw, Search, WalletCards, X, Send, ReceiptText, ScrollText, LogOut
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const apiFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const token = window.sessionStorage.getItem('daraja_admin_token') ?? '';
  return fetch(input, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` }
  });
};

type DashboardTransaction = {
  receipt: string;
  name: string;
  amount: number | string;
  method: string;
  status: string;
  time: string;
  checkoutRequestId?: string;
  resultCode?: number;
  resultDesc?: string;
};

const formatAmount = (amount: number) => `KES ${amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

const navigation = [
  { label: 'Overview', icon: BarChart3 }, { label: 'Collections', icon: ArrowDownLeft },
  { label: 'Disbursements', icon: Send }, { label: 'Invoices', icon: ReceiptText },
  { label: 'Transactions', icon: CreditCard }, { label: 'Audit logs', icon: ScrollText }
];

export default function AdminOverview() {
  const [activeNav, setActiveNav] = useState('Overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [balance, setBalance] = useState('Not queried');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [transactions, setTransactions] = useState<DashboardTransaction[]>([]);
  const [toast, setToast] = useState('');
  const [statusReceipt, setStatusReceipt] = useState('');
  const [checkout, setCheckout] = useState({ phoneNumber: '254', amount: '', reference: '', description: 'Payment' });
  const [chartData, setChartData] = useState<Array<{ time: string; collections: number; payouts: number }>>([]);
  const [collectionsToday, setCollectionsToday] = useState(0);
  const [payoutsToday, setPayoutsToday] = useState(0);
  const [pendingInvoices, setPendingInvoices] = useState(0);
  const [pendingInvoiceAmount, setPendingInvoiceAmount] = useState(0);

  const metrics = [
    { label: 'Collections today', value: formatAmount(collectionsToday), change: 'Today', icon: ArrowDownLeft, tone: 'emerald' },
    { label: 'Payouts today', value: formatAmount(payoutsToday), change: 'Today', icon: ArrowUpRight, tone: 'amber' },
    { label: 'Account balance', value: balance, change: 'Database', icon: WalletCards, tone: 'emerald' },
    { label: 'Pending invoices', value: String(pendingInvoices), change: formatAmount(pendingInvoiceAmount), icon: CreditCard, tone: 'slate' }
  ];

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3500);
  };

  const filteredTransactions = useMemo(() => transactions.filter((tx) =>
    `${tx.receipt} ${tx.name} ${tx.method} ${tx.status}`.toLowerCase().includes(search.toLowerCase())
  ), [transactions, search]);

  const refreshDashboard = async () => {
    await loadDashboard(false);
  };

  const checkBalance = async () => {
    setBalanceLoading(true);
    try {
      const response = await apiFetch('/api/v1/account/balance', { method: 'POST' });
      const data = await response.json();
      if (data.balance) setBalance(`KES ${Number(data.balance).toLocaleString()}`);
      else notify(data.error || 'Balance endpoint is awaiting Daraja confirmation');
    } catch {
      notify('Could not reach the Daraja backend');
    } finally {
      setBalanceLoading(false);
    }
  };

  const submitCheckout = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const response = await apiFetch('/api/v1/checkout/stk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: checkout.phoneNumber, amount: Number(checkout.amount), accountReference: checkout.reference, transactionDesc: checkout.description })
      });
      const data = await response.json();
      if (!response.ok) {
        const darajaMessage = data.darajaResponse?.errorMessage
          || data.darajaResponse?.ResponseDescription
          || data.darajaResponse?.error;
        const darajaCode = data.darajaResponse?.errorCode;
        throw new Error(darajaMessage ? `${darajaCode ? `${darajaCode}: ` : ''}${darajaMessage}` : (data.error || 'Checkout request failed'));
      }
      setTransactions((current) => [{
        receipt: '—',
        name: checkout.phoneNumber,
        amount: `KES ${Number(checkout.amount).toLocaleString()}`,
        method: 'STK Push',
        status: 'Pending',
        time: 'Just now',
        checkoutRequestId: data.CheckoutRequestID
      }, ...current]);
      setCheckoutOpen(false);
      notify(data.CustomerMessage || 'STK push sent successfully');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Checkout request failed');
    }
  };

  const lookupStatus = () => {
    if (!statusReceipt.trim()) return notify('Enter a receipt or request ID');
    const found = transactions.find((tx) => tx.receipt.toLowerCase() === statusReceipt.toLowerCase());
    if (found) return notify(`Status: ${found.status}`);

    apiFetch('/api/v1/checkout/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkoutRequestId: statusReceipt.trim() })
    }).then(async (response) => {
      const data = await response.json();
      if (response.ok) {
        notify(data.ResultDesc || data.status || 'Status retrieved');
      } else {
        const darajaMessage = data.darajaResponse?.errorMessage || data.darajaResponse?.ResponseDescription;
        const darajaCode = data.darajaResponse?.errorCode;
        notify(darajaMessage ? `${darajaCode ? `${darajaCode}: ` : ''}${darajaMessage}` : (data.error || 'Unable to query transaction'));
      }
    }).catch(() => notify('Could not reach the Daraja backend'));
  };

  const selectNavigation = (label: string) => {
    setActiveNav(label);
    setSidebarOpen(false);
    if (label !== 'Overview') notify(`${label} workspace selected`);
  };

  const loadDashboard = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [summaryResponse, cashflowResponse] = await Promise.all([
        apiFetch('/api/v1/dashboard/summary'),
        apiFetch('/api/v1/dashboard/cashflow')
      ]);
      if (!summaryResponse.ok) throw new Error('Database summary unavailable');
      const summary = await summaryResponse.json();
      setCollectionsToday(Number(summary.collectionsToday ?? 0));
      setPayoutsToday(Number(summary.payoutsToday ?? 0));
      setPendingInvoices(Number(summary.pendingInvoices ?? 0));
      setPendingInvoiceAmount(Number(summary.pendingInvoiceAmount ?? 0));
      if (summary.accountBalance !== null) setBalance(formatAmount(Number(summary.accountBalance)));
      setTransactions((summary.recentTransactions ?? []).map((tx: DashboardTransaction) => ({
        ...tx,
        amount: typeof tx.amount === 'number' ? formatAmount(tx.amount) : tx.amount,
        time: typeof tx.time === 'string' ? new Date(tx.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : String(tx.time)
      })));
      if (cashflowResponse.ok) {
        const cashflow = await cashflowResponse.json();
        setChartData(cashflow.data ?? []);
      }
      if (!silent) notify('Dashboard refreshed');
    } catch (error) {
      if (!silent) notify(error instanceof Error ? error.message : 'Unable to load dashboard');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!window.sessionStorage.getItem('daraja_admin_token')) {
      const token = window.prompt('Enter the Daraja admin API token');
      if (token?.trim()) window.sessionStorage.setItem('daraja_admin_token', token.trim());
    }
    void loadDashboard(true);
    const interval = window.setInterval(() => void loadDashboard(true), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen bg-slate-900 text-slate-50">
      {sidebarOpen && <button aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-slate-950/75 backdrop-blur-sm lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-slate-800 bg-slate-950 p-5 transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-8 flex items-center justify-between"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-emerald-500"><Landmark size={22}/></div><div><p className="font-bold">Daraja</p><p className="text-xs text-slate-400">Control Center</p></div></div><button aria-label="Close menu" onClick={() => setSidebarOpen(false)} className="text-slate-400 lg:hidden"><X size={20}/></button></div>
        <nav>{navigation.map(({ label, icon: Icon }) => <button key={label} onClick={() => selectNavigation(label)} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition ${activeNav === label ? 'bg-emerald-600/15 text-emerald-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><Icon size={18}/>{label}</button>)}</nav>
        <button onClick={() => { window.sessionStorage.removeItem('daraja_admin_token'); notify('Session signed out'); }} className="absolute bottom-5 left-5 right-5 flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-slate-400 hover:bg-slate-800"><LogOut size={18}/>Sign out</button>
      </aside>

      <section className="lg:ml-64">
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-slate-800/80 bg-slate-900/95 px-5 backdrop-blur md:px-8">
          <div className="flex items-center gap-3"><button aria-label="Open menu" onClick={() => setSidebarOpen(true)} className="grid size-10 place-items-center rounded-lg border border-slate-700 lg:hidden"><Menu size={20}/></button><div><p className="hidden text-xs text-slate-400 sm:block">Production environment</p><h1 className="mt-1 text-lg font-semibold sm:text-xl">{activeNav}</h1></div></div>
          <div className="flex items-center gap-2 sm:gap-3"><button aria-label="Search" onClick={() => setSearchOpen((value) => !value)} className="grid size-10 place-items-center rounded-lg border border-slate-700 text-slate-300"><Search size={18}/></button><button onClick={() => setStatusOpen(true)} className="hidden rounded-lg border border-slate-700 px-3 py-2.5 text-sm text-slate-300 sm:block">Check status</button><button onClick={() => setCheckoutOpen(true)} className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold hover:bg-emerald-500 sm:px-4">New payment</button></div>
        </header>

        {searchOpen && <div className="border-b border-slate-800 px-5 py-3 md:px-8"><div className="relative"><Search size={16} className="absolute left-3 top-3 text-slate-400"/><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search receipt, customer, method or status" className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2.5 pl-9 pr-4 text-sm outline-none focus:border-emerald-500"/></div></div>}

        <div className="p-5 md:p-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, change, icon: Icon, tone }) => <article key={label} className="rounded-2xl border border-slate-800 bg-slate-800 p-5 transition hover:-translate-y-0.5 hover:border-slate-700"><div className="flex items-start justify-between"><div className={`grid size-10 place-items-center rounded-xl ${tone === 'amber' ? 'bg-amber-500/15 text-amber-500' : 'bg-emerald-500/15 text-emerald-500'}`}><Icon size={20}/></div><span className="rounded-full bg-slate-900 px-2 py-1 text-xs text-slate-300">{change}</span></div><p className="mt-5 text-sm text-slate-400">{label}</p><p className="mt-1 truncate text-xl font-semibold">{value}</p></article>)}</div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"><article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-800 p-5 md:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold">Cashflow overview</h2><p className="mt-1 text-xs text-slate-400">Today · hourly volume</p></div><button onClick={refreshDashboard} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs hover:bg-slate-700"><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''}/><span className="hidden sm:inline">Refresh</span></button></div><div className="h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="collections" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.35}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="time" stroke="#94A3B8" fontSize={12}/><YAxis stroke="#94A3B8" fontSize={12}/><Tooltip contentStyle={{ background:'#0F172A',border:'1px solid #334155',borderRadius:'10px' }}/><Area type="monotone" dataKey="collections" stroke="#10B981" fill="url(#collections)"/><Area type="monotone" dataKey="payouts" stroke="#F59E0B" fill="transparent"/></AreaChart></ResponsiveContainer></div></article>

            <article className="rounded-2xl border border-slate-800 bg-slate-800 p-5"><h2 className="font-semibold">System status</h2><div className="mt-5 space-y-4 text-sm"><div className="flex justify-between"><span className="text-slate-400">Daraja API</span><span className="text-emerald-400">● Operational</span></div><div className="flex justify-between"><span className="text-slate-400">Callback listener</span><span className="text-emerald-400">● Healthy</span></div><div className="flex justify-between"><span className="text-slate-400">Queue workers</span><span className="text-emerald-400">● 4 active</span></div></div><button onClick={checkBalance} disabled={balanceLoading} className="mt-6 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-60">{balanceLoading ? 'Checking…' : 'Check live balance'}</button></article></div>

          <article className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-800"><div className="flex items-center justify-between p-5"><div><h2 className="font-semibold">Recent transactions</h2><p className="mt-1 text-xs text-slate-400">Latest collection activity</p></div><button onClick={() => setActiveNav('Transactions')} className="text-sm text-emerald-400">View all</button></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-y border-slate-700 text-xs text-slate-400"><tr><th className="px-5 py-3">Receipt</th><th>Customer</th><th>Method</th><th>Amount</th><th>Status</th><th className="px-5">Time</th></tr></thead><tbody>{filteredTransactions.map((tx) => <tr key={`${tx.receipt}-${tx.name}-${tx.time}`} className="border-b border-slate-700/60 last:border-0"><td className="px-5 py-4 font-mono text-xs">{tx.receipt}</td><td>{tx.name}</td><td className="text-slate-400">{tx.method}</td><td className="font-medium">{formatAmount(typeof tx.amount === 'number' ? tx.amount : 0)}</td><td><span title={tx.resultDesc ? `${tx.resultCode ? `${tx.resultCode}: ` : ''}${tx.resultDesc}` : undefined} className={`rounded-full px-2 py-1 text-xs ${tx.status === 'Success' ? 'bg-emerald-500/15 text-emerald-400' : tx.status === 'Pending' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>{tx.status}</span></td><td className="px-5 text-slate-400">{tx.time}</td></tr>)}</tbody></table>{filteredTransactions.length === 0 && <p className="p-8 text-center text-sm text-slate-400">No matching transactions</p>}</div></article>
        </div>
      </section>

      {checkoutOpen && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm"><form onSubmit={submitCheckout} className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-5 shadow-2xl"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold">Initiate STK Push</h2><p className="text-xs text-slate-400">Send a secure M-Pesa prompt</p></div><button type="button" onClick={() => setCheckoutOpen(false)}><X size={20}/></button></div><div className="space-y-4"><label className="block text-sm text-slate-300">Phone number<input required value={checkout.phoneNumber} onChange={(event) => setCheckout({ ...checkout, phoneNumber: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 outline-none focus:border-emerald-500" placeholder="2547XXXXXXXX"/></label><label className="block text-sm text-slate-300">Amount (KES)<input required type="number" min="1" value={checkout.amount} onChange={(event) => setCheckout({ ...checkout, amount: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 outline-none focus:border-emerald-500" placeholder="1000"/></label><label className="block text-sm text-slate-300">Account reference<input required maxLength={12} value={checkout.reference} onChange={(event) => setCheckout({ ...checkout, reference: event.target.value })} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 outline-none focus:border-emerald-500" placeholder="ORDER-001"/></label></div><button type="submit" className="mt-5 w-full rounded-xl bg-emerald-600 py-3 font-semibold hover:bg-emerald-500">Send payment prompt</button></form></div>}

      {statusOpen && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-5"><div className="mb-5 flex items-center justify-between"><h2 className="font-semibold">Transaction status</h2><button onClick={() => setStatusOpen(false)}><X size={20}/></button></div><input value={statusReceipt} onChange={(event) => setStatusReceipt(event.target.value)} placeholder="Enter receipt or checkout ID" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 outline-none focus:border-emerald-500"/><button onClick={lookupStatus} className="mt-4 w-full rounded-xl bg-emerald-600 py-3 font-semibold hover:bg-emerald-500">Look up status</button></div></div>}

      {toast && <div className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm shadow-2xl">{toast}</div>}
    </main>
  );
}
