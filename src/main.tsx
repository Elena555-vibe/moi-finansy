import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, Car, Check, ChevronRight, CirclePlus, Clapperboard, Gift, GraduationCap, HeartPulse, Home, House, List, Monitor, MoreHorizontal, Package, PiggyBank, Plane, Settings, Shirt, ShoppingCart, Sparkles, Tag, Trash2, Utensils, Wifi, X } from 'lucide-react';
import { CloudSession, createAccount, getRegistrationStatus, pullState, pushState, RegistrationStatus, serverConfigured, signIn } from './cloud';
import './styles.css';

type TxType = 'expense' | 'income' | 'reserve' | 'savings_withdrawal' | 'debt_received' | 'debt_payment';
type Transaction = { id: string; type: TxType; amount: number; date: string; categoryId?: string; sourceId?: string; comment?: string };
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
const categoryDefinitions = [
  ['housing', 'Жильё', 'housing', ['utilities']],
  ['groceries', 'Продукты', 'groceries', ['products']],
  ['household', 'Бытовые товары', 'household', ['household_goods', 'Бытовая химия']],
  ['food_delivery', 'Кафе', 'food_delivery', ['cafe', 'restaurants', 'delivery', 'кафе, рестораны, доставка еды']],
  ['transport', 'Транспорт', 'transport', []],
  ['connectivity', 'Связь и интернет', 'connectivity', ['connection']],
  ['health', 'Здоровье', 'health', []],
  ['beauty', 'Красота', 'beauty', []],
  ['clothes', 'Одежда и обувь', 'clothes', []],
  ['education', 'Образование', 'education', []],
  ['entertainment', 'Развлечения', 'entertainment', []],
  ['subscriptions', 'Цифровые сервисы', 'subscriptions', ['подписки и цифровые сервисы']],
  ['gifts', 'Подарки', 'gifts', ['подарки и благотворительность']],
  ['travel', 'Путешествия и отпуск', 'travel', []],
  ['other', 'Прочее', 'other', ['unexpected']],
] as const;
const categoryIconMap = { housing: House, groceries: ShoppingCart, household: Package, food_delivery: Utensils, transport: Car, connectivity: Wifi, health: HeartPulse, beauty: Sparkles, clothes: Shirt, education: GraduationCap, entertainment: Clapperboard, subscriptions: Monitor, gifts: Gift, travel: Plane, other: MoreHorizontal, custom: Tag };
const categoryAlias = (category: Category) => [category.id, category.name].map((value) => value.trim().toLowerCase());
const normalizedCategories = (categories?: Category[]) => {
  const existing = categories || [];
  const matched = new Set<string>();
  const current = categoryDefinitions.map(([id, name, icon, aliases]) => {
    const matching = existing.find((category) => categoryAlias(category).some((value) => [id, name, ...aliases].map((alias) => alias.toLowerCase()).includes(value)));
    if (matching) matched.add(matching.id);
    return matching ? { ...matching, name, icon } : { id, name, icon };
  });
  // Keep a user's choice for custom categories. They start active when created,
  // but can later be archived safely when already referenced by history.
  return [...current, ...existing.filter((category) => !matched.has(category.id))];
};
const defaultData = (): Data => ({
  onboarded: false, initialBalance: 0, initialBalanceDate: today(),
  categories: normalizedCategories(),
  sources: [['salary','Зарплата'],['self','Самозанятость'],['interest','Проценты по вкладу'],['other','Прочее']].map(([id,name]) => ({ id,name })),
  transactions: [], future: [], savings: { targetAmount: 0 }, plans: []
});

function normalizeData(raw?: Partial<Data>): Data {
  const base = defaultData();
  return {
    ...base,
    ...raw,
    categories: normalizedCategories(raw?.categories),
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
  const [sheet, setSheet] = useState<'expense'|'income'|'reserve'|'savings_withdrawal'|'debt_received'|'debt_payment'|'future'|'futureForm'|'futureActions'|'savings'|'debt'|'cloud'|'onboard'|null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editingFuture, setEditingFuture] = useState<FuturePayment | null>(null);
  const [futureActions, setFutureActions] = useState<FuturePayment | null>(null);
  const [paying, setPaying] = useState<FuturePayment | null>(null);
  useEffect(() => { loadData().then((loaded) => { setData(loaded); saveData(loaded); }); if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`); }, []);
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
    if (!data) return null; const month = monthKey();
    const income = data.transactions.filter((t) => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const expenses = data.transactions.filter((t) => t.type === 'expense'); const debtReceived = data.transactions.filter((t) => t.type === 'debt_received').reduce((s,t) => s + t.amount, 0); const debtPaid = data.transactions.filter((t) => t.type === 'debt_payment').reduce((s,t) => s + t.amount, 0);
    const totalExpenses = expenses.reduce((s,t) => s + t.amount, 0); const reserves = data.transactions.filter((t) => t.type === 'reserve').reduce((s,t) => s + t.amount, 0);
    const withdrawals = data.transactions.filter((t) => t.type === 'savings_withdrawal').reduce((s,t) => s + t.amount, 0);
    const balance = data.initialBalance + income + debtReceived - totalExpenses - debtPaid;
    const reserve = reserves - withdrawals;
    // Legacy debt remains saved only for backward compatibility. The current
    // debt balance is managed exclusively through its dedicated operations.
    return { month, income, totalExpenses, balance, reserve, free: balance - reserve, remainingSavings: data.savings.targetAmount - reserve, debtReceived, debtPaid, debtOutstanding: debtReceived - debtPaid };
  }, [data]);
  if (!data || !calc) return <main className="loading">Загружаем ваши финансы…</main>;
  if (!data.onboarded) return <Onboarding data={data} onDone={commit} />;
  const categoriesSpent = data.categories.map((c) => ({ ...c, amount: data.transactions.filter((t) => t.type === 'expense' && t.categoryId === c.id && monthKey(t.date) === calc.month).reduce((s,t) => s+t.amount,0) })).filter((c) => c.amount > 0).sort((a,b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ru'));
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
    {page === 'operations' && <Operations data={data} onEdit={(t) => { setEditing(t); setSheet(t.type === 'income' ? 'income' : t.type === 'reserve' ? 'reserve' : t.type === 'savings_withdrawal' ? 'savings_withdrawal' : t.type === 'debt_received' ? 'debt_received' : t.type === 'debt_payment' ? 'debt_payment' : 'expense'); }} onDelete={removeTx} onFutureActions={(payment) => { setFutureActions(payment); setSheet('futureActions'); }} onDeleteFuture={removeFuture} />}
    {page === 'plan' && <PlanPage data={data} calc={calc} onSavings={() => setSheet('savings')} onDebt={() => setSheet('debt')} />}
    {page === 'settings' && <SettingsPage data={data} onSave={commit} onCloud={() => setSheet('cloud')} />}
    <button className="fab" aria-label="Добавить операцию" onClick={() => setSheet('future')}> <CirclePlus size={28} /> </button>
    <nav>{([['home','Главная',Home],['operations','Операции',List],['plan','Копилка',PiggyBank],['settings','Настройки',Settings]] as const).map(([key,label,Icon]) => <button key={key} className={page===key?'active':''} onClick={() => setPage(key)}><Icon size={21}/><span>{label}</span></button>)}</nav>
    {sheet === 'future' && <ChoiceSheet onClose={() => setSheet(null)} onPick={(v) => setSheet(v)} />}
    {sheet && ['expense','income','reserve','savings_withdrawal','debt_received','debt_payment'].includes(sheet) && <TransactionSheet type={sheet as 'expense'|'income'|'reserve'|'savings_withdrawal'|'debt_received'|'debt_payment'} data={data} initial={editing || (paying ? { type:'expense', amount: paying.amount, date: paying.date, categoryId: paying.categoryId } : undefined)} onClose={() => { setSheet(null); setEditing(null); setPaying(null); }} onSave={addTx} />}
    {sheet === 'future' && null}
    {sheet === 'savings' && <SavingsSheet savings={data.savings} calc={calc} onClose={() => setSheet(null)} onSaveTarget={(targetAmount) => commit({ ...data, savings: { targetAmount } })} onWithdraw={(amount, date) => addTx({ type:'savings_withdrawal', amount, date })} />}
    {sheet === 'debt' && <DebtSheet calc={calc} onClose={() => setSheet(null)} onReceive={() => setSheet('debt_received')} onPay={() => setSheet('debt_payment')} />}
    {sheet === 'futureForm' && <FutureSheet data={data} initial={editingFuture || undefined} onClose={() => { setSheet(null); setEditingFuture(null); }} onSave={(payment) => { const future = editingFuture ? data.future.map((item) => item.id === editingFuture.id ? { ...payment, id: item.id, paid: item.paid } : item) : [...data.future, { ...payment, id: uid() }]; commit({ ...data, future }); setEditingFuture(null); setSheet(null); }} />}
    {sheet === 'futureActions' && futureActions && <FutureActionsSheet payment={futureActions} onClose={() => { setFutureActions(null); setSheet(null); }} onConfirmPayment={() => { setPaying(futureActions); setFutureActions(null); setSheet('expense'); }} onEdit={() => { setEditingFuture(futureActions); setFutureActions(null); setSheet('futureForm'); }} onDelete={() => removeFuture(futureActions.id)} />}
    {sheet === 'cloud' && <CloudSheet data={data} onClose={() => setSheet(null)} onSave={commit} />}
  </main>;
}

function Onboarding({ data, onDone }: { data: Data; onDone: (d:Data)=>void }) { const [balance,setBalance]=useState(''); return <main className="onboard"><div className="brand">Мои финансы</div><div className="onboard-card"><p className="eyebrow">Начальная настройка</p><h1>С чего начинаем?</h1><p>Укажите, сколько денег у вас есть сейчас. Копилку и долговые обязательства можно добавить позже.</p><MoneyInput value={balance} onChange={setBalance}/><button className="primary" onClick={()=>onDone({...data,onboarded:true,initialBalance:Number(balance)||0})}>Открыть приложение <ChevronRight size={18}/></button></div></main> }

function CategoryIcon({ icon, size = 18 }: { icon: string; size?: number }) { const Icon = categoryIconMap[icon as keyof typeof categoryIconMap] || Tag; return <Icon className="category-icon" size={size} strokeWidth={1.8} aria-hidden="true" />; }
function HomePage({calc,categories,imminent,onOpen}:{calc:any;categories:any[];imminent:FuturePayment[];onOpen:()=>void}) { const total=categories.reduce((s,c)=>s+c.amount,0); return <section><header><h1>Главная</h1><div className="avatar">●</div></header>{imminent[0]&&<button className="reminder" onClick={onOpen}><CalendarDays size={18}/><span><b>{reminderLabel(imminent[0].date)}:</b> запланированный платёж {money(imminent[0].amount)}</span></button>}<div className="hero balance-hero"><div className="hero-stats"><span>Общий остаток <b>{money(calc.balance)}</b></span><span>Свободные деньги <b>{money(calc.free)}</b></span></div></div><h2>Расходы за месяц</h2>{total ? <div className="chart-wrap category-bars">{categories.map((c,index)=>{const color=chartColors[index%chartColors.length];return <div className="legend" key={c.id}><span><CategoryIcon icon={c.icon} size={16}/>{c.name}</span><b>{money(c.amount)}</b><div className="category-bar" aria-label={`${c.name}: ${money(c.amount)}`}><i style={{width:`${c.amount/total*100}%`,backgroundColor:color}}/></div></div>})}</div> : <div className="empty">Добавьте первую трату — здесь появится распределение по категориям.</div>}</section> }

function Operations({data,onEdit,onDelete,onFutureActions,onDeleteFuture}:{data:Data;onEdit:(t:Transaction)=>void;onDelete:(id:string)=>void;onFutureActions:(p:FuturePayment)=>void;onDeleteFuture:(id:string)=>void}) { const items=[...data.transactions].sort((a,b)=>b.date.localeCompare(a.date)); return <section><header><h1>Операции</h1></header><div className="hero balance-hero operation-summary"><div className="hero-stats"><span>Доходы <b>{money(items.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0))}</b></span><span>Расходы <b>{money(items.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amount,0))}</b></span></div></div>{items.length===0&&!data.future.length?<div className="empty">Операций пока нет. Нажмите «+», чтобы добавить первую.</div>:<div className="list">{items.map(t=>{const isPositive=t.type==='income'||t.type==='savings_withdrawal'||t.type==='debt_received';const title=t.type==='income'?(data.sources.find(s=>s.id===t.sourceId)?.name||'Доход'):t.type==='reserve'?'В копилку':t.type==='savings_withdrawal'?'Из копилки':t.type==='debt_received'?'Взяла в долг':t.type==='debt_payment'?'Вернула долг':data.categories.find(c=>c.id===t.categoryId)?.name||'Расход';return <article key={t.id} className="operation"><div><strong>{title}</strong><small>{dateLabel(t.date)}{t.comment ? <> · <span className="operation-comment">{t.comment}</span></> : ''}</small></div><b className={isPositive?'positive':''}>{isPositive?'+':'−'}{money(t.amount)}</b><button onClick={()=>onEdit(t)} aria-label="Изменить">•••</button><button onClick={()=>onDelete(t.id)} aria-label="Удалить"><Trash2 size={16}/></button></article>})}{data.future.map(p=><article key={p.id} className="operation future"><div><strong>{data.categories.find(c=>c.id===p.categoryId)?.name||'Платёж'}</strong><small>{dateLabel(p.date)} · <span className="future-status">{p.paid?'Оплачено':'Ожидается'}</span></small></div><b>{money(p.amount)}</b>{!p.paid&&<><button onClick={()=>onFutureActions(p)} aria-label="Действия с ожидаемым платежом"><MoreHorizontal size={20}/></button><button onClick={()=>onDeleteFuture(p.id)} aria-label="Удалить ожидаемый платёж"><Trash2 size={16}/></button></>}</article>)}</div>}</section> }

function PlanPage({data,calc,onSavings,onDebt}:{data:Data;calc:any;onSavings:()=>void;onDebt:()=>void}) { return <section className="savings-page"><header><h1>Копилка</h1></header><section className="savings-card savings-summary"><p>В копилке</p><strong>{money(calc.reserve)}</strong><small>{data.savings.targetAmount ? `До цели осталось: ${money(calc.remainingSavings)}` : 'Цель пока не задана'}</small><button className="secondary savings-manage-action" onClick={onSavings}>Управлять <ChevronRight size={18}/></button></section><section className="savings-card debt-summary"><p>Долговые обязательства</p><strong>{money(calc.debtOutstanding)}</strong><small>Возвращено: {money(calc.debtPaid)}</small><button className="secondary savings-manage-action" onClick={onDebt}>Управлять <ChevronRight size={18}/></button></section></section> }

function SettingsPage({data,onSave,onCloud}:{data:Data;onSave:(d:Data)=>void;onCloud:()=>void}) {
  const [balance,setBalance]=useState(String(data.initialBalance));
  const [categoryName,setCategoryName]=useState('');
  const [sourceName,setSourceName]=useState('');
  const activeCategories=data.categories.filter(c=>!c.archived);
  const archivedCategories=data.categories.filter(c=>c.archived);
  const addCategory=()=>{if(categoryName.trim()) {onSave({...data,categories:[...data.categories,{id:uid(),name:categoryName.trim(),icon:'custom'}]});setCategoryName('');}};
  const addSource=()=>{if(sourceName.trim()) {onSave({...data,sources:[...data.sources,{id:uid(),name:sourceName.trim()}]});setSourceName('');}};
  const archiveCategory=(id:string)=>onSave({...data,categories:data.categories.map(x=>x.id===id?{...x,archived:true}:x)});
  const restoreCategory=(id:string)=>onSave({...data,categories:data.categories.map(x=>x.id===id?{...x,archived:false}:x)});
  const removeCategory=(category:Category)=>{
    const inUse=data.transactions.some(transaction=>transaction.categoryId===category.id)||data.future.some(payment=>payment.categoryId===category.id);
    if(inUse){
      if(confirm(`«${category.name}» уже есть в истории. Архивировать её, сохранив записи?`)) archiveCategory(category.id);
      return;
    }
    if(confirm(`Удалить категорию «${category.name}»?`)) onSave({...data,categories:data.categories.filter(item=>item.id!==category.id)});
  };
  return <section><header><h1>Настройки</h1></header><label>Начальный остаток<MoneyInput value={balance} onChange={setBalance}/></label><button className="secondary" onClick={()=>onSave({...data,initialBalance:Number(balance)||0})}>Сохранить остаток</button><section className="cloud-card cloud-protection"><div><p>Защита данных</p><small>{data.cloud ? (data.cloud.dirty ? 'Есть несинхронизированные изменения' : `Сохранено: ${data.cloud.lastSyncedAt ? new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(new Date(data.cloud.lastSyncedAt)) : 'сервер подключён'}`) : 'Серверная копия пока не подключена'}</small></div><button onClick={onCloud}>{data.cloud ? 'Открыть' : 'Подключить'}</button></section><h2>Категории</h2><div className="settings-list">{activeCategories.map(c=><div key={c.id}><CategoryIcon icon={c.icon}/><span>{c.name}</span><button onClick={()=>c.icon==='custom'?removeCategory(c):archiveCategory(c.id)}>{c.icon==='custom'?'Удалить':'Архивировать'}</button></div>)}</div><div className="inline-add"><input value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder="Новая категория"/><button onClick={addCategory}>Добавить</button></div>{archivedCategories.length>0&&<><h3 className="settings-subtitle">Архивные категории</h3><div className="settings-list archived-list">{archivedCategories.map(c=><div key={c.id}><CategoryIcon icon={c.icon}/><span>{c.name}</span><button onClick={()=>restoreCategory(c.id)}>Восстановить</button>{c.icon==='custom'&&<button className="delete-category" onClick={()=>removeCategory(c)}>Удалить</button>}</div>)}</div></>}<h2>Источники дохода</h2><div className="settings-list">{data.sources.filter(s=>!s.archived).map(s=><div key={s.id}><span>{s.name}</span><button onClick={()=>onSave({...data,sources:data.sources.map(x=>x.id===s.id?{...x,archived:true}:x)})}>Архивировать</button></div>)}</div><div className="inline-add"><input value={sourceName} onChange={e=>setSourceName(e.target.value)} placeholder="Новый источник дохода"/><button onClick={addSource}>Добавить</button></div></section>
}

function CloudSheet({data,onClose,onSave}:{data:Data;onClose:()=>void;onSave:(data:Data)=>void}) { const [email,setEmail]=useState(data.cloud?.email||''); const [password,setPassword]=useState(''); const [mode,setMode]=useState<'register'|'login'>(data.cloud?'login':'register'); const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false); const [registration,setRegistration]=useState<RegistrationStatus|null>(null); useEffect(()=>{ let active=true; if (!data.cloud&&serverConfigured()) getRegistrationStatus().then((status)=>{if(active)setRegistration(status);}).catch(()=>undefined); return ()=>{active=false;}; },[data.cloud]); const atCapacity=registration?.available===0; const connect=async()=>{ setBusy(true); setMessage(''); try { const session=mode==='register'?await createAccount(email,password):await signIn(email,password); const remote=await pullState<Data>(session); if (remote.state && remote.state.onboarded && !confirm('На сервере уже есть финансовая история. Восстановить её на этом устройстве? Текущие локальные данные будут заменены.')) { setMessage('Восстановление отменено. Локальные данные не менялись.'); return; } const next=remote.state && remote.state.onboarded ? { ...remote.state, cloud:{...session,dirty:false,lastSyncedAt:remote.updatedAt||new Date().toISOString()} } : { ...data, cloud:{...session,dirty:false,lastSyncedAt:new Date().toISOString()} }; if (!remote.state) await pushState(session,next); onSave(next); setMessage(remote.state ? 'Данные восстановлены с сервера.' : 'Текущие данные безопасно сохранены на сервере.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось подключиться к серверу.'); } finally { setBusy(false); } }; const sync=async()=>{ if (!data.cloud) return; setBusy(true); try { const next={...data,cloud:{...data.cloud,dirty:false,lastSyncedAt:new Date().toISOString()}}; await pushState(data.cloud,next); onSave(next); setMessage('Серверная копия обновлена.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось обновить копию.'); } finally { setBusy(false); } }; const capacityText=registration ? (registration.available ? `Доступно ещё ${registration.available} из ${registration.capacity} личных копий.` : `Лимит ${registration.capacity} личных копий достигнут.`) : ''; return <Sheet onClose={onClose}><h2>Защита данных</h2>{!serverConfigured()?<p className="muted">Серверная часть подготовлена, но адрес API ещё не указан. После настройки сайта на Timeweb подключение станет доступно здесь.</p>:data.cloud?<><p className="muted">Вы вошли как {data.cloud.email}. Локальная копия остаётся доступной без сети.</p><button className="primary" disabled={busy} onClick={sync}>{busy?'Сохраняем…':'Синхронизировать сейчас'}</button></>:<><p className="muted">Создайте личный доступ. У каждого аккаунта — отдельная история, которую не видят другие пользователи. {capacityText}</p><label>E-mail<input value={email} onChange={e=>setEmail(e.target.value)} inputMode="email" placeholder="you@example.com"/></label><label>Пароль<input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Не менее 12 символов"/></label><button className="primary" disabled={busy||!email||password.length<12||(mode==='register'&&atCapacity)} onClick={connect}>{busy?'Подключаем…':mode==='register'?'Создать защищённую копию':'Войти и восстановить'}</button><button className="text-button" disabled={busy} onClick={()=>setMode(mode==='register'?'login':'register')}>{mode==='register'?'У меня уже есть аккаунт':'Создать новый аккаунт'}</button></>}{message&&<p className="cloud-message">{message}</p>}</Sheet> }
function ChoiceSheet({onClose,onPick}:{onClose:()=>void;onPick:(x:any)=>void}) { return <Sheet onClose={onClose}><h2>Добавить</h2>{[['expense','Расход'],['income','Доход'],['reserve','В копилку'],['future','Будущий платёж']].map(([key,label])=><button className="choice" key={key} onClick={()=>key==='future'?onPick('futureForm'):onPick(key)}>{label}<ChevronRight/></button>)}</Sheet> }
function TransactionSheet({type,data,initial,onClose,onSave}:{type:'expense'|'income'|'reserve'|'savings_withdrawal'|'debt_received'|'debt_payment';data:Data;initial?:Partial<Transaction>;onClose:()=>void;onSave:(x:Omit<Transaction,'id'>)=>void}) { const [amount,setAmount]=useState(String(initial?.amount||''));const [date,setDate]=useState(initial?.date||today());const [ref,setRef]=useState(initial?.categoryId||initial?.sourceId||'');const [comment,setComment]=useState(initial?.comment||''); const options=type==='income'?data.sources.filter(x=>!x.archived):data.categories.filter(x=>!x.archived);const isNoReferenceMovement=type==='reserve'||type==='savings_withdrawal'||type==='debt_received'||type==='debt_payment';const title=type==='expense'?'Расход':type==='income'?'Доход':type==='reserve'?'В копилку':type==='savings_withdrawal'?'Из копилки':type==='debt_received'?'Взяла в долг':'Вернула долг';return <Sheet onClose={onClose}><h2>{title}</h2>{type==='debt_received'&&<p className="muted">Сумма увеличит общий остаток, но не будет считаться доходом.</p>}{type==='debt_payment'&&<p className="muted">Сумма уменьшит общий остаток и долг, но не повседневный лимит.</p>}<label>Сумма<MoneyInput value={amount} onChange={setAmount}/></label>{!isNoReferenceMovement&&<label>{type==='income'?'Источник':'Категория'}<select value={ref} onChange={e=>setRef(e.target.value)}><option value="">Выберите</option>{options.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}{type==='income'&&<label>Комментарий (необязательно)<input value={comment} onChange={e=>setComment(e.target.value)} placeholder="Например, от кого получен подарок"/></label>}<label>Дата<DateInput value={date} onChange={setDate}/></label><button className="primary" disabled={!amount|| (!isNoReferenceMovement&&!ref)} onClick={()=>onSave({type,amount:Number(amount),date,...(type==='income'?{sourceId:ref,comment:comment.trim()||undefined}:type==='expense'?{categoryId:ref}:{})})}>Сохранить <Check size={18}/></button></Sheet> }
function FutureSheet({data,initial,onClose,onSave}:{data:Data;initial?:FuturePayment;onClose:()=>void;onSave:(p:Omit<FuturePayment,'id'|'paid'>)=>void}){const [amount,setAmount]=useState(String(initial?.amount||''));const [date,setDate]=useState(initial?.date||today());const [categoryId,setCategoryId]=useState(initial?.categoryId||'');return <Sheet onClose={onClose}><h2>{initial?'Изменить будущий платёж':'Будущий платёж'}</h2><p className="muted">Это напоминание. Оно не уменьшит баланс до подтверждения оплаты.</p><label>Сумма<MoneyInput value={amount} onChange={setAmount}/></label><label>Категория<select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Выберите</option>{data.categories.filter(c=>!c.archived).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Дата<DateInput value={date} onChange={setDate}/></label><button className="primary" disabled={!amount||!categoryId} onClick={()=>onSave({amount:Number(amount),date,categoryId})}>Сохранить <Check size={18}/></button></Sheet>}
function FutureActionsSheet({payment,onClose,onConfirmPayment,onEdit,onDelete}:{payment:FuturePayment;onClose:()=>void;onConfirmPayment:()=>void;onEdit:()=>void;onDelete:()=>void}) { return <Sheet onClose={onClose}><h2>Ожидаемый платёж</h2><p className="muted">{money(payment.amount)} · {dateLabel(payment.date)}</p><button className="choice" onClick={onConfirmPayment}>Подтвердить оплату <ChevronRight/></button><button className="choice" onClick={onEdit}>Редактировать <ChevronRight/></button><button className="choice" onClick={onDelete}>Удалить <Trash2 size={18}/></button></Sheet> }
function SavingsSheet({savings,calc,onClose,onSaveTarget,onWithdraw}:{savings:Savings;calc:any;onClose:()=>void;onSaveTarget:(targetAmount:number)=>void;onWithdraw:(amount:number,date:string)=>void}) {const [target,setTarget]=useState(String(savings.targetAmount||''));const [amount,setAmount]=useState('');const [date,setDate]=useState(today());return <Sheet onClose={onClose}><div className="savings-management"><h2>Управление копилкой</h2><p className="muted">В копилке сейчас: <b>{money(calc.reserve)}</b></p><label>Целевая сумма<MoneyInput value={target} onChange={setTarget}/></label><button className="secondary" onClick={()=>onSaveTarget(Number(target)||0)}>Сохранить цель</button><label>Изъять из копилки<MoneyInput value={amount} onChange={setAmount}/></label><label>Дата<DateInput value={date} onChange={setDate}/></label><button className="primary" disabled={!amount} onClick={()=>{onWithdraw(Number(amount),date);onClose();}}>Вернуть в доступные деньги</button></div></Sheet> }
function DebtSheet({calc,onClose,onReceive,onPay}:{calc:any;onClose:()=>void;onReceive:()=>void;onPay:()=>void}){return <Sheet onClose={onClose}><h2>Долговые обязательства</h2><div className="debt-sheet-summary"><span>К возврату</span><strong>{money(calc.debtOutstanding)}</strong><small>Возвращено: {money(calc.debtPaid)}</small></div><button className="choice" onClick={onReceive}>Взяла в долг <ChevronRight/></button><button className="choice" onClick={onPay}>Вернула долг <ChevronRight/></button></Sheet>}
function Sheet({children,onClose}:{children:React.ReactNode;onClose:()=>void}){return <div className="overlay"><div className="sheet"><button className="close" onClick={onClose}><X/></button>{children}</div></div>}
function MoneyInput({value,onChange}:{value:string;onChange:(x:string)=>void}){return <div className="money-input"><input inputMode="numeric" value={value} onChange={e=>onChange(e.target.value.replace(/\D/g,''))} placeholder="0"/><span>₽</span></div>}
function DateInput({value,onChange}:{value:string;onChange:(value:string)=>void}){return <div className="date-input"><span>{dateLabel(value)}</span><input type="date" value={value} aria-label="Выберите дату" onChange={e=>onChange(e.target.value)}/></div>}

createRoot(document.getElementById('root')!).render(<App />);
