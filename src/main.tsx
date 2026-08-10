import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, Check, ChevronRight, CirclePlus, Home, List, MoreHorizontal, PiggyBank, Settings, Trash2, X } from 'lucide-react';
import { CloudSession, createAccount, getRegistrationStatus, pullState, pushState, RegistrationStatus, serverConfigured, signIn } from './cloud';
import './styles.css';

type TxType = 'expense' | 'income' | 'reserve' | 'savings_withdrawal' | 'debt_payment';
type Transaction = { id: string; type: TxType; amount: number; date: string; categoryId?: string; sourceId?: string };
type Category = { id: string; name: string; icon: string; archived?: boolean };
type Source = { id: string; name: string; archived?: boolean };
type FuturePayment = { id: string; amount: number; date: string; categoryId: string; paid?: boolean };
type LegacyDebt = { initialAmount: number; nextPaymentDate: string; nextPaymentAmount: number };
type Savings = { targetAmount: number };
type Plan = { month: string; plannedIncome: number; plannedReserve: number };
type Data = { onboarded: boolean; initialBalance: number; initialBalanceDate: string; categories: Category[]; sources: Source[]; transactions: Transaction[]; future: FuturePayment[]; savings: Savings; plans: Plan[]; debt?: LegacyDebt; cloud?: CloudSession };
type Page = 'home' | 'operations' | 'plan' | 'settings';

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const monthKey = (date = today()) => date.slice(0, 7);
const uid = () => crypto.randomUUID();
const money = (n: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)} ₽`;
const dateLabel = (date: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
const daysUntil = (date: string) => Math.round((new Date(`${date}T12:00`).getTime() - new Date(`${today()}T12:00`).getTime()) / 86_400_000);
const reminderLabel = (date: string) => {
  const days = daysUntil(date);
  if (days < 0) return 'Просрочен';
  if (days === 0) return 'Сегодня';
  return 'Завтра';
};
const chartColors = ['#14320F', '#315525', '#5C9843', '#6FAE52', '#6A8FA3', '#9AA193'];
const defaultData = (): Data => ({
  onboarded: false, initialBalance: 0, initialBalanceDate: today(),
  categories: [['products','Продукты','🛒'],['transport','Транспорт','🚌'],['utilities','Коммунальные платежи','⌂'],['subscriptions','Подписки','◉'],['connection','Связь','⌁'],['debts','Долги','◎'],['unexpected','Непредвиденные расходы','!'],['other','Прочее','•••']].map(([id,name,icon]) => ({ id,name,icon })),
  sources: [['salary','Зарплата'],['self','Самозанятость'],['interest','Проценты по вкладу'],['other','Прочее']].map(([id,name]) => ({ id,name })),
  transactions: [], future: [], savings: { targetAmount: 0 }, plans: []
});

function normalizeData(raw?: Partial<Data>): Data {
  const base = defaultData();
  return {
    ...base,
    ...raw,
    categories: raw?.categories || base.categories,
    sources: raw?.sources || base.sources,
    transactions: raw?.transactions || [],
    future: raw?.future || [],
    plans: raw?.plans || [],
    savings: raw?.savings || { targetAmount: raw?.debt?.initialAmount || 0 },
  };
}

async function loadData(): Promise<Data> {
  return new Promise((resolve) => { const r = indexedDB.open('moi-finansy', 1); r.onupgradeneeded = () => r.result.createObjectStore('state'); r.onsuccess = () => { const tx = r.result.transaction('state', 'readonly').objectStore('state').get('data'); tx.onsuccess = () => resolve(normalizeData(tx.result)); tx.onerror = () => resolve(defaultData()); }; r.onerror = () => resolve(defaultData()); });
}
async function saveData(data: Data) { return new Promise<void>((resolve) => { const r = indexedDB.open('moi-finansy', 1); r.onsuccess = () => { const tx = r.result.transaction('state', 'readwrite'); tx.objectStore('state').put(data, 'data'); tx.oncomplete = () => resolve(); }; }); }

function App() {
  const [data, setData] = useState<Data | null>(null); const [page, setPage] = useState<Page>('home');
  const [sheet, setSheet] = useState<'expense'|'income'|'reserve'|'savings_withdrawal'|'future'|'futureForm'|'futureActions'|'savings'|'cloud'|'onboard'|null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editingFuture, setEditingFuture] = useState<FuturePayment | null>(null);
  const [futureActions, setFutureActions] = useState<FuturePayment | null>(null);
  const [paying, setPaying] = useState<FuturePayment | null>(null);
  useEffect(() => { loadData().then(setData); if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`); }, []);
  useEffect(() => {
    if (!data?.cloud?.dirty) return;
    const syncPending = () => {
      if (!navigator.onLine || !data.cloud) return;
      const synced = { ...data, cloud: { ...data.cloud, dirty: false, lastSyncedAt: new Date().toISOString() } };
      pushState(data.cloud, synced).then(() => { setData((current) => current === data ? synced : current); saveData(synced); }).catch(() => undefined);
    };
    syncPending(); window.addEventListener('online', syncPending);
    return () => window.removeEventListener('online', syncPending);
  }, [data]);
  const commit = (next: Data) => {
    const normalized = normalizeData(next);
    const pending = normalized.cloud ? { ...normalized, cloud: { ...normalized.cloud, dirty: true } } : normalized;
    setData(pending); saveData(pending);
  };
  const calc = useMemo(() => {
    if (!data) return null; const month = monthKey(); const plan = data.plans.find((p) => p.month === month) || { month, plannedIncome: 0, plannedReserve: 0 };
    const income = data.transactions.filter((t) => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const expenses = data.transactions.filter((t) => t.type === 'expense'); const legacyDebtPaid = data.transactions.filter((t) => t.type === 'debt_payment').reduce((s,t) => s + t.amount, 0);
    const totalExpenses = expenses.reduce((s,t) => s + t.amount, 0); const reserves = data.transactions.filter((t) => t.type === 'reserve').reduce((s,t) => s + t.amount, 0);
    const withdrawals = data.transactions.filter((t) => t.type === 'savings_withdrawal').reduce((s,t) => s + t.amount, 0);
    const monthExpenses = expenses.filter((t) => monthKey(t.date) === month).reduce((s,t) => s + t.amount, 0);
    const balance = data.initialBalance + income - totalExpenses - legacyDebtPaid; const reserve = reserves - legacyDebtPaid - withdrawals; const limit = plan.plannedIncome - plan.plannedReserve;
    return { month, plan, income, totalExpenses, monthExpenses, balance, reserve, free: balance - reserve, limit, remaining: limit - monthExpenses, remainingReserve: plan.plannedReserve - reserve, remainingSavings: data.savings.targetAmount - reserve };
  }, [data]);
  if (!data || !calc) return <main className="loading">Загружаем ваши финансы…</main>;
  if (!data.onboarded) return <Onboarding data={data} onDone={commit} />;
  const categoriesSpent = data.categories.map((c) => ({ ...c, amount: data.transactions.filter((t) => t.type === 'expense' && t.categoryId === c.id && monthKey(t.date) === calc.month).reduce((s,t) => s+t.amount,0) })).filter((c) => c.amount > 0);
  const imminent = data.future.filter((p) => !p.paid && daysUntil(p.date) <= 1).sort((a, b) => a.date.localeCompare(b.date));
  const addTx = (tx: Omit<Transaction,'id'>) => {
    const transactions = editing
      ? data.transactions.map((item) => item.id === editing.id ? { ...tx, id: item.id } : item)
      : [...data.transactions, { ...tx, id: uid() }];
    const future = paying
      ? data.future.map((payment) => payment.id === paying.id ? { ...payment, paid: true } : payment)
      : data.future;
    commit({ ...data, transactions, future });
    setEditing(null); setPaying(null); setSheet(null);
  };
  const removeTx = (id: string) => { if (confirm('Удалить эту операцию?')) commit({ ...data, transactions: data.transactions.filter((t) => t.id !== id) }); };
  const removeFuture = (id: string) => {
    if (confirm('Удалить ожидаемый платёж?')) commit({ ...data, future: data.future.filter((payment) => payment.id !== id) });
    setFutureActions(null); setSheet(null);
  };
  return <main className="app">
    {page === 'home' && <HomePage calc={calc} categories={categoriesSpent} imminent={imminent} onOpen={() => setSheet('future')} />}
    {page === 'operations' && <Operations data={data} onEdit={(t) => { setEditing(t); setSheet(t.type === 'income' ? 'income' : t.type === 'reserve' ? 'reserve' : t.type === 'savings_withdrawal' ? 'savings_withdrawal' : 'expense'); }} onDelete={removeTx} onFutureActions={(payment) => { setFutureActions(payment); setSheet('futureActions'); }} onDeleteFuture={removeFuture} />}
    {page === 'plan' && <PlanPage data={data} calc={calc} onSave={(plan) => commit({ ...data, plans: [...data.plans.filter((p) => p.month !== calc.month), plan] })} onSavings={() => setSheet('savings')} />}
    {page === 'settings' && <SettingsPage data={data} onSave={commit} onCloud={() => setSheet('cloud')} />}
    <button className="fab" aria-label="Добавить операцию" onClick={() => setSheet('future')}> <CirclePlus size={28} /> </button>
    <nav>{([['home','Главная',Home],['operations','Операции',List],['plan','Копилка',PiggyBank],['settings','Настройки',Settings]] as const).map(([key,label,Icon]) => <button key={key} className={page===key?'active':''} onClick={() => setPage(key)}><Icon size={21}/><span>{label}</span></button>)}</nav>
    {sheet === 'future' && <ChoiceSheet onClose={() => setSheet(null)} onPick={(v) => setSheet(v)} />}
    {sheet && ['expense','income','reserve','savings_withdrawal'].includes(sheet) && <TransactionSheet type={sheet as 'expense'|'income'|'reserve'|'savings_withdrawal'} data={data} initial={editing || (paying ? { type:'expense', amount: paying.amount, date: paying.date, categoryId: paying.categoryId } : undefined)} onClose={() => { setSheet(null); setEditing(null); setPaying(null); }} onSave={addTx} />}
    {sheet === 'future' && null}
    {sheet === 'savings' && <SavingsSheet savings={data.savings} calc={calc} onClose={() => setSheet(null)} onSaveTarget={(targetAmount) => commit({ ...data, savings: { targetAmount } })} onWithdraw={(amount, date) => addTx({ type:'savings_withdrawal', amount, date })} />}
    {sheet === 'futureForm' && <FutureSheet data={data} initial={editingFuture || undefined} onClose={() => { setSheet(null); setEditingFuture(null); }} onSave={(payment) => { const future = editingFuture ? data.future.map((item) => item.id === editingFuture.id ? { ...payment, id: item.id, paid: item.paid } : item) : [...data.future, { ...payment, id: uid() }]; commit({ ...data, future }); setEditingFuture(null); setSheet(null); }} />}
    {sheet === 'futureActions' && futureActions && <FutureActionsSheet payment={futureActions} onClose={() => { setFutureActions(null); setSheet(null); }} onConfirmPayment={() => { setPaying(futureActions); setFutureActions(null); setSheet('expense'); }} onEdit={() => { setEditingFuture(futureActions); setFutureActions(null); setSheet('futureForm'); }} onDelete={() => removeFuture(futureActions.id)} />}
    {sheet === 'cloud' && <CloudSheet data={data} onClose={() => setSheet(null)} onSave={commit} />}
  </main>;
}

function Onboarding({ data, onDone }: { data: Data; onDone: (d:Data)=>void }) { const [step,setStep]=useState(0); const [balance,setBalance]=useState(''); const [income,setIncome]=useState(''); const [reserve,setReserve]=useState(''); const finish=()=>onDone({...data,onboarded:true,initialBalance:Number(balance)||0,plans:[{month:monthKey(),plannedIncome:Number(income)||0,plannedReserve:Number(reserve)||0}]}); return <main className="onboard"><div className="brand">Мои финансы</div><div className="onboard-card"><p className="eyebrow">Шаг {step+1} из 2</p>{step===0&&<><h1>С чего начинаем?</h1><p>Укажите, сколько денег у вас есть сейчас.</p><MoneyInput value={balance} onChange={setBalance}/></>}{step===1&&<><h1>План на месяц</h1><p>Лимит автоматически вычтет плановый резерв.</p><label>Планируемый доход<MoneyInput value={income} onChange={setIncome}/></label><label>Плановый резерв<MoneyInput value={reserve} onChange={setReserve}/></label></>}<button className="primary" onClick={()=>step<1?setStep(step+1):finish()}>{step<1?'Продолжить':'Открыть приложение'} <ChevronRight size={18}/></button></div></main> }

function HomePage({calc,categories,imminent,onOpen}:{calc:any;categories:any[];imminent:FuturePayment[];onOpen:()=>void}) { const total=categories.reduce((s,c)=>s+c.amount,0); const stops=categories.reduce<{color:string;from:number;to:number}[]>((result, category, index) => { const from=result.length ? result[result.length - 1].to : 0; return [...result,{color:chartColors[index%chartColors.length],from,to:from+category.amount/total*100}]; },[]); const gradient=stops.map(({color,from,to})=>`${color} ${from}% ${to}%`).join(', '); return <section><header><h1>Главная</h1><div className="avatar">●</div></header>{imminent[0]&&<button className="reminder" onClick={onOpen}><CalendarDays size={18}/><span><b>{reminderLabel(imminent[0].date)}:</b> запланированный платёж {money(imminent[0].amount)}</span></button>}<div className="hero"><p>Осталось потратить</p><strong>{money(calc.remaining)}</strong><div className="hero-stats"><span>Общий остаток <b>{money(calc.balance)}</b></span><span>Свободные деньги <b>{money(calc.free)}</b></span></div></div><h2>Расходы за месяц</h2>{total ? <div className="chart-wrap"><div className="donut" style={{background:`conic-gradient(${gradient})`}}><i/></div><div>{categories.map((c,index)=><div className="legend" key={c.id}><span><i className="legend-marker" style={{backgroundColor:chartColors[index%chartColors.length]}}/>{c.icon} {c.name}</span><b>{money(c.amount)}</b></div>)}</div></div> : <div className="empty">Добавьте первую трату — здесь появится распределение по категориям.</div>}</section> }

function Operations({data,onEdit,onDelete,onFutureActions,onDeleteFuture}:{data:Data;onEdit:(t:Transaction)=>void;onDelete:(id:string)=>void;onFutureActions:(p:FuturePayment)=>void;onDeleteFuture:(id:string)=>void}) { const items=[...data.transactions].sort((a,b)=>b.date.localeCompare(a.date)); return <section><header><h1>Операции</h1></header><div className="operation-summary"><span>Доходы <b>{money(items.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0))}</b></span><span>Расходы <b>{money(items.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amount,0))}</b></span></div>{items.length===0&&!data.future.length?<div className="empty">Операций пока нет. Нажмите «+», чтобы добавить первую.</div>:<div className="list">{items.map(t=><article key={t.id} className="operation"><div><strong>{t.type==='income'?'Доход':t.type==='reserve'?'В копилку':t.type==='savings_withdrawal'?'Из копилки':t.type==='debt_payment'?'Платёж по долгу':data.categories.find(c=>c.id===t.categoryId)?.name||'Расход'}</strong><small>{dateLabel(t.date)}</small></div><b className={t.type==='income'||t.type==='savings_withdrawal'?'positive':''}>{t.type==='income'||t.type==='savings_withdrawal'?'+':'−'}{money(t.amount)}</b><button onClick={()=>onEdit(t)} aria-label="Изменить">•••</button><button onClick={()=>onDelete(t.id)} aria-label="Удалить"><Trash2 size={16}/></button></article>)}{data.future.map(p=><article key={p.id} className="operation future"><div><strong>{data.categories.find(c=>c.id===p.categoryId)?.name||'Платёж'}</strong><small>{dateLabel(p.date)} · <span className="future-status">{p.paid?'Оплачено':'Ожидается'}</span></small></div><b>{money(p.amount)}</b>{!p.paid&&<><button onClick={()=>onFutureActions(p)} aria-label="Действия с ожидаемым платежом"><MoreHorizontal size={20}/></button><button onClick={()=>onDeleteFuture(p.id)} aria-label="Удалить ожидаемый платёж"><Trash2 size={16}/></button></>}</article>)}</div>}</section> }

function PlanPage({data,calc,onSave,onSavings}:{data:Data;calc:any;onSave:(p:Plan)=>void;onSavings:()=>void}) { const [income,setIncome]=useState(String(calc.plan.plannedIncome||'')); const [reserve,setReserve]=useState(String(calc.plan.plannedReserve||'')); return <section><header><h1>Копилка</h1></header><div className="hero"><p>Лимит на месяц</p><strong>{money((Number(income)||0)-(Number(reserve)||0))}</strong><div className="progress"><i style={{width:`${Math.max(0,Math.min(100, calc.monthExpenses / Math.max(1,(Number(income)||0)-(Number(reserve)||0))*100))}%`}}/></div></div><label>Планируемый доход<MoneyInput value={income} onChange={setIncome}/></label><label>Плановый резерв<MoneyInput value={reserve} onChange={setReserve}/></label><button className="primary" onClick={()=>onSave({month:calc.month,plannedIncome:Number(income)||0,plannedReserve:Number(reserve)||0})}>Сохранить план <Check size={18}/></button><div className="reserve-card"><p>В копилке</p><strong>{money(calc.reserve)}</strong><small>{data.savings.targetAmount ? `До цели осталось: ${money(calc.remainingSavings)}` : 'Цель пока не задана'}</small><button onClick={onSavings}>Управлять копилкой <ChevronRight size={16}/></button></div></section> }

function SettingsPage({data,onSave,onCloud}:{data:Data;onSave:(d:Data)=>void;onCloud:()=>void}) { const [balance,setBalance]=useState(String(data.initialBalance)); const [name,setName]=useState(''); const add=()=>{if(name.trim()) {onSave({...data,categories:[...data.categories,{id:uid(),name:name.trim(),icon:'•'}]});setName('');}}; return <section><header><h1>Настройки</h1></header><label>Начальный остаток<MoneyInput value={balance} onChange={setBalance}/></label><button className="secondary" onClick={()=>onSave({...data,initialBalance:Number(balance)||0})}>Сохранить остаток</button><section className="cloud-card"><div><p>Защита данных</p><small>{data.cloud ? (data.cloud.dirty ? 'Есть несинхронизированные изменения' : `Сохранено: ${data.cloud.lastSyncedAt ? new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(new Date(data.cloud.lastSyncedAt)) : 'сервер подключён'}`) : 'Серверная копия пока не подключена'}</small></div><button onClick={onCloud}>{data.cloud ? 'Открыть' : 'Подключить'}</button></section><h2>Категории</h2><div className="settings-list">{data.categories.map(c=><div key={c.id}>{c.icon} {c.name}<button onClick={()=>onSave({...data,categories:data.categories.map(x=>x.id===c.id?{...x,archived:!x.archived}:x)})}>{c.archived?'Вернуть':'Архивировать'}</button></div>)}</div><div className="inline-add"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Новая категория"/><button onClick={add}>Добавить</button></div><h2>Источники дохода</h2><div className="settings-list">{data.sources.map(s=><div key={s.id}>{s.name}<button onClick={()=>onSave({...data,sources:data.sources.map(x=>x.id===s.id?{...x,archived:!x.archived}:x)})}>{s.archived?'Вернуть':'Архивировать'}</button></div>)}</div></section> }

function CloudSheet({data,onClose,onSave}:{data:Data;onClose:()=>void;onSave:(data:Data)=>void}) { const [email,setEmail]=useState(data.cloud?.email||''); const [password,setPassword]=useState(''); const [mode,setMode]=useState<'register'|'login'>(data.cloud?'login':'register'); const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false); const [registration,setRegistration]=useState<RegistrationStatus|null>(null); useEffect(()=>{ let active=true; if (!data.cloud&&serverConfigured()) getRegistrationStatus().then((status)=>{if(active)setRegistration(status);}).catch(()=>undefined); return ()=>{active=false;}; },[data.cloud]); const atCapacity=registration?.available===0; const connect=async()=>{ setBusy(true); setMessage(''); try { const session=mode==='register'?await createAccount(email,password):await signIn(email,password); const remote=await pullState<Data>(session); if (remote.state && remote.state.onboarded && !confirm('На сервере уже есть финансовая история. Восстановить её на этом устройстве? Текущие локальные данные будут заменены.')) { setMessage('Восстановление отменено. Локальные данные не менялись.'); return; } const next=remote.state && remote.state.onboarded ? { ...remote.state, cloud:{...session,dirty:false,lastSyncedAt:remote.updatedAt||new Date().toISOString()} } : { ...data, cloud:{...session,dirty:false,lastSyncedAt:new Date().toISOString()} }; if (!remote.state) await pushState(session,next); onSave(next); setMessage(remote.state ? 'Данные восстановлены с сервера.' : 'Текущие данные безопасно сохранены на сервере.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось подключиться к серверу.'); } finally { setBusy(false); } }; const sync=async()=>{ if (!data.cloud) return; setBusy(true); try { const next={...data,cloud:{...data.cloud,dirty:false,lastSyncedAt:new Date().toISOString()}}; await pushState(data.cloud,next); onSave(next); setMessage('Серверная копия обновлена.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось обновить копию.'); } finally { setBusy(false); } }; const capacityText=registration ? (registration.available ? `Доступно ещё ${registration.available} из ${registration.capacity} личных копий.` : `Лимит ${registration.capacity} личных копий достигнут.`) : ''; return <Sheet onClose={onClose}><h2>Защита данных</h2>{!serverConfigured()?<p className="muted">Серверная часть подготовлена, но адрес API ещё не указан. После настройки сайта на Timeweb подключение станет доступно здесь.</p>:data.cloud?<><p className="muted">Вы вошли как {data.cloud.email}. Локальная копия остаётся доступной без сети.</p><button className="primary" disabled={busy} onClick={sync}>{busy?'Сохраняем…':'Синхронизировать сейчас'}</button></>:<><p className="muted">Создайте личный доступ. У каждого аккаунта — отдельная история, которую не видят другие пользователи. {capacityText}</p><label>E-mail<input value={email} onChange={e=>setEmail(e.target.value)} inputMode="email" placeholder="you@example.com"/></label><label>Пароль<input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Не менее 12 символов"/></label><button className="primary" disabled={busy||!email||password.length<12||(mode==='register'&&atCapacity)} onClick={connect}>{busy?'Подключаем…':mode==='register'?'Создать защищённую копию':'Войти и восстановить'}</button><button className="text-button" disabled={busy} onClick={()=>setMode(mode==='register'?'login':'register')}>{mode==='register'?'У меня уже есть аккаунт':'Создать новый аккаунт'}</button></>}{message&&<p className="cloud-message">{message}</p>}</Sheet> }
function ChoiceSheet({onClose,onPick}:{onClose:()=>void;onPick:(x:any)=>void}) { return <Sheet onClose={onClose}><h2>Добавить</h2>{[['expense','Расход'],['income','Доход'],['reserve','В копилку'],['future','Будущий платёж']].map(([key,label])=><button className="choice" key={key} onClick={()=>key==='future'?onPick('futureForm'):onPick(key)}>{label}<ChevronRight/></button>)}</Sheet> }
function TransactionSheet({type,data,initial,onClose,onSave}:{type:'expense'|'income'|'reserve'|'savings_withdrawal';data:Data;initial?:Partial<Transaction>;onClose:()=>void;onSave:(x:Omit<Transaction,'id'>)=>void}) { const [amount,setAmount]=useState(String(initial?.amount||''));const [date,setDate]=useState(initial?.date||today());const [ref,setRef]=useState(initial?.categoryId||initial?.sourceId||''); const options=type==='income'?data.sources.filter(x=>!x.archived):data.categories.filter(x=>!x.archived);const isSavingsMovement=type==='reserve'||type==='savings_withdrawal';return <Sheet onClose={onClose}><h2>{type==='expense'?'Расход':type==='income'?'Доход':type==='reserve'?'В копилку':'Из копилки'}</h2><label>Сумма<MoneyInput value={amount} onChange={setAmount}/></label>{!isSavingsMovement&&<label>{type==='income'?'Источник':'Категория'}<select value={ref} onChange={e=>setRef(e.target.value)}><option value="">Выберите</option>{options.map(x=><option key={x.id} value={x.id}>{('icon' in x?x.icon+' ':'')+x.name}</option>)}</select></label>}<label>Дата<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="primary" disabled={!amount|| (!isSavingsMovement&&!ref)} onClick={()=>onSave({type,amount:Number(amount),date,...(type==='income'?{sourceId:ref}:type==='expense'?{categoryId:ref}:{})})}>Сохранить <Check size={18}/></button></Sheet> }
function FutureSheet({data,initial,onClose,onSave}:{data:Data;initial?:FuturePayment;onClose:()=>void;onSave:(p:Omit<FuturePayment,'id'|'paid'>)=>void}){const [amount,setAmount]=useState(String(initial?.amount||''));const [date,setDate]=useState(initial?.date||today());const [categoryId,setCategoryId]=useState(initial?.categoryId||'');return <Sheet onClose={onClose}><h2>{initial?'Изменить будущий платёж':'Будущий платёж'}</h2><p className="muted">Это напоминание. Оно не уменьшит баланс и лимит до подтверждения оплаты.</p><label>Сумма<MoneyInput value={amount} onChange={setAmount}/></label><label>Категория<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Выберите</option>{data.categories.filter(c=>!c.archived).map(c=><option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></label><label>Дата<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="primary" disabled={!amount||!categoryId} onClick={()=>onSave({amount:Number(amount),date,categoryId})}>Сохранить <Check size={18}/></button></Sheet>}
function FutureActionsSheet({payment,onClose,onConfirmPayment,onEdit,onDelete}:{payment:FuturePayment;onClose:()=>void;onConfirmPayment:()=>void;onEdit:()=>void;onDelete:()=>void}) { return <Sheet onClose={onClose}><h2>Ожидаемый платёж</h2><p className="muted">{money(payment.amount)} · {dateLabel(payment.date)}</p><button className="choice" onClick={onConfirmPayment}>Подтвердить оплату <ChevronRight/></button><button className="choice" onClick={onEdit}>Редактировать <ChevronRight/></button><button className="choice" onClick={onDelete}>Удалить <Trash2 size={18}/></button></Sheet> }
function SavingsSheet({savings,calc,onClose,onSaveTarget,onWithdraw}:{savings:Savings;calc:any;onClose:()=>void;onSaveTarget:(targetAmount:number)=>void;onWithdraw:(amount:number,date:string)=>void}) {const [target,setTarget]=useState(String(savings.targetAmount||''));const [amount,setAmount]=useState('');const [date,setDate]=useState(today());return <Sheet onClose={onClose}><h2>Управление копилкой</h2><p className="muted">В копилке сейчас: <b>{money(calc.reserve)}</b></p><label>Целевая сумма<MoneyInput value={target} onChange={setTarget}/></label><button className="secondary" onClick={()=>onSaveTarget(Number(target)||0)}>Сохранить цель</button><label>Изъять из копилки<MoneyInput value={amount} onChange={setAmount}/></label><label>Дата<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="primary" disabled={!amount} onClick={()=>{onWithdraw(Number(amount),date);onClose();}}>Вернуть в доступные деньги</button></Sheet> }
function Sheet({children,onClose}:{children:React.ReactNode;onClose:()=>void}){return <div className="overlay"><div className="sheet"><button className="close" onClick={onClose}><X/></button>{children}</div></div>}
function MoneyInput({value,onChange}:{value:string;onChange:(x:string)=>void}){return <div className="money-input"><input inputMode="numeric" value={value} onChange={e=>onChange(e.target.value.replace(/\D/g,''))} placeholder="0"/><span>₽</span></div>}

createRoot(document.getElementById('root')!).render(<App />);
