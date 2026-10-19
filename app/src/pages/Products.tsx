import { useEffect, useMemo, useRef, useState } from 'react';
import { avgCost, type ProductState } from '../core/ledger';
import { lineTotal, money, moneyInput, parseMoney, parseQty, qty, qtyInput, uid } from '../core/format';
import { store } from '../core/store';
import { PRODUCT_CATEGORIES, type Pay, type Unit } from '../core/types';
import { exportProductsXlsx, planImport, templateXlsx, type ImportPlan } from '../excel';
import { pickFile, saveFile, todayStamp } from '../platform';
import { Confirm, Icon, Modal, useStore, useToast } from '../ui';
import { plural } from './Summary';

const UNITS: Unit[] = ['шт', 'уп', 'кг', 'г', 'л'];

export function Products({ lowOnly: lowInit, purchaseNonce }: { lowOnly?: boolean; purchaseNonce: number }) {
  const { ledger } = useStore();
  const toast = useToast();
  const [cat, setCat] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(!!lowInit);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<ProductState | 'new' | null>(null);
  const [adjust, setAdjust] = useState<ProductState | null>(null);
  const [purchase, setPurchase] = useState<{ pids: string[] } | null>(null);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);

  useEffect(() => setLowOnly(!!lowInit), [lowInit]);
  useEffect(() => {
    if (purchaseNonce) setPurchase({ pids: [] });
  }, [purchaseNonce]);

  const isLow = (p: ProductState) => p.min > 0 && p.stock < p.min;
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ledger.productList.filter(
      (p) => (!cat || p.category === cat) && (!lowOnly || isLow(p)) && (!s || p.name.toLowerCase().includes(s) || p.barcode === q.trim()),
    );
  }, [ledger, cat, lowOnly, q]);

  const all = ledger.productList;
  const stockCost = all.reduce((s, p) => s + (p.stock > 0 ? p.value : 0), 0);
  const stockProfit = all.reduce((s, p) => s + (p.stock > 0 ? lineTotal(p.stock, p.sell) - p.value : 0), 0);
  const lowCount = all.filter(isLow).length;

  async function doImport() {
    const f = await pickFile('.xlsx,.xls,.csv');
    if (!f) return;
    try {
      setImportPlan(planImport(f.bytes, ledger));
    } catch {
      toast('Не вдалося прочитати файл. Збережіть його як .xlsx і спробуйте ще раз', 'err');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Товари й залишки</h1>
          <div className="sub">Закупівельна ціна — основа для розрахунку чистого прибутку</div>
        </div>
        <div className="row">
          <button className="btn" onClick={doImport}>
            Імпорт з Excel
          </button>
          <button className="btn" onClick={() => setEdit('new')}>
            + Новий товар
          </button>
          <button className="btn primary" onClick={() => setPurchase({ pids: [] })}>
            + Надходження товару
          </button>
        </div>
      </div>

      <section className="grid-kpi">
        <div className="card kpi">
          <div className="label">Позицій у каталозі</div>
          <div className="val">{all.length}</div>
        </div>
        <div className="card kpi">
          <div className="label">Склад за закупівлею</div>
          <div className="val">{money(stockCost, { whole: true })}</div>
        </div>
        <div className="card kpi">
          <div className="label">Якщо продати весь склад</div>
          <div className="val good">{money(stockProfit, { sign: true, whole: true })}</div>
        </div>
        <div className="card kpi" style={lowCount ? { background: 'var(--warn-soft)', borderColor: 'var(--warn-line)' } : undefined}>
          <div className="label" style={lowCount ? { color: 'var(--warn-ink)' } : undefined}>
            Нижче мінімуму
          </div>
          <div className="val" style={lowCount ? { color: 'var(--warn-ink)' } : undefined}>
            {lowCount} {plural(lowCount, 'товар', 'товари', 'товарів')}
          </div>
        </div>
      </section>

      <div className="row">
        <label className="search">
          {Icon.search()}
          <input type="search" aria-label="Пошук товару" placeholder="Пошук за назвою або штрихкодом" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className="btn small" onClick={() => saveFile(`gryadka-tovary-${todayStamp()}.xlsx`, exportProductsXlsx(ledger), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>
          Експорт в Excel
        </button>
        <button className="btn small" onClick={() => saveFile('gryadka-shablon-tovariv.xlsx', templateXlsx(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>
          Шаблон для імпорту
        </button>
      </div>
      <div className="chips">
        <button className="chip" aria-pressed={!cat} onClick={() => setCat(null)}>
          Усі
        </button>
        {ledger.categories.map((c) => (
          <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
            {c}
          </button>
        ))}
        <button className="chip warnchip" aria-pressed={lowOnly} onClick={() => setLowOnly(!lowOnly)}>
          Лише ті, що закінчуються
        </button>
      </div>

      <div className="tablebox">
        {list.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Категорія</th>
                <th className="r">Закупівля</th>
                <th className="r">Продаж</th>
                <th className="r">Націнка</th>
                <th className="r">Прибуток / од.</th>
                <th className="r">Залишок</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const cost = Math.round(avgCost(p));
                const low = isLow(p);
                return (
                  <tr key={p.pid} className={low ? 'low' : ''}>
                    <td className="wrap" style={{ fontWeight: 500 }}>
                      {p.name}
                      {p.barcode && <div className="muted num" style={{ fontSize: 12, fontWeight: 400 }}>{p.barcode}</div>}
                    </td>
                    <td className="muted">{p.category}</td>
                    <td className="r num">{cost ? money(cost) : '—'}</td>
                    <td className="r num">{money(p.sell)}</td>
                    <td className="r num">{cost ? `${Math.round(((p.sell - cost) / cost) * 100)}%` : '—'}</td>
                    <td className={`r num ${p.sell - cost >= 0 ? 'good' : 'warn'}`}>{cost ? money(p.sell - cost, { sign: true }) : '—'}</td>
                    <td className={`r num ${low || p.stock < 0 ? 'warn' : ''}`} style={{ fontWeight: low ? 600 : 400 }}>
                      {qty(p.stock)} {p.unit}
                    </td>
                    <td className="r">
                      <div className="row" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        <button className="btn small" onClick={() => setPurchase({ pids: [p.pid] })} title="Оформити надходження">
                          + Прихід
                        </button>
                        <button className="iconbtn" aria-label={`Списання або інвентаризація: ${p.name}`} title="Списання / інвентаризація" onClick={() => setAdjust(p)}>
                          {Icon.scale()}
                        </button>
                        <button className="iconbtn" aria-label={`Редагувати ${p.name}`} title="Редагувати" onClick={() => setEdit(p)}>
                          {Icon.edit()}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            {all.length ? 'Нічого не знайдено' : 'Каталог порожній. Додайте перший товар або завантажте список з Excel.'}
          </div>
        )}
      </div>
      <div className="hint" style={{ fontSize: 13 }}>
        Собівартість рахується за середньою ціною закупівлі: якщо нова партія прийшла дорожче, ціна перерахується автоматично.
      </div>

      {edit && <ProductModal product={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {adjust && <AdjustModal product={adjust} onClose={() => setAdjust(null)} />}
      {purchase && <PurchaseModal initial={purchase.pids} onClose={() => setPurchase(null)} />}
      {importPlan && (
        <Confirm
          title="Імпорт товарів"
          text={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                Нових товарів: <b>{importPlan.created}</b>, оновити: <b>{importPlan.updated}</b>
              </div>
              {importPlan.stockLines > 0 && (
                <div>
                  Початкові залишки: <b>{importPlan.stockLines}</b> позицій на суму <b className="num">{money(importPlan.stockValue)}</b> (за закупівельними цінами)
                </div>
              )}
              {importPlan.skipped.length > 0 && (
                <div className="warn" style={{ fontSize: 13 }}>
                  Пропущено {importPlan.skipped.length}: {importPlan.skipped.slice(0, 4).join('; ')}
                  {importPlan.skipped.length > 4 ? '…' : ''}
                </div>
              )}
              <div className="hint" style={{ fontSize: 12 }}>
                Колонки: Назва, Категорія, Од., Ціна продажу, Ціна закупівлі, Залишок, Мін. залишок, Штрихкод. Товари з такою ж назвою або штрихкодом оновляться.
              </div>
            </div>
          }
          ok={importPlan.events.length ? 'Імпортувати' : 'Закрити'}
          onClose={() => setImportPlan(null)}
          onOk={async () => {
            if (!importPlan.events.length) return;
            await store.addMany(importPlan.events);
            toast(`Імпортовано: ${importPlan.created + importPlan.updated} товарів`);
          }}
        />
      )}
    </>
  );
}

/* ---------- картка товару ---------- */
export function ProductModal({ product, onClose, onSaved, initialName }: { product: ProductState | null; onClose: () => void; onSaved?: (pid: string) => void; initialName?: string }) {
  const { ledger } = useStore();
  const toast = useToast();
  const [name, setName] = useState(product?.name || initialName || '');
  const [category, setCategory] = useState(product?.category || '');
  const [unit, setUnit] = useState<Unit>(product?.unit || 'шт');
  const [sell, setSell] = useState(product ? moneyInput(product.sell) : '');
  const [min, setMin] = useState(product ? qtyInput(product.min) : '');
  const [barcode, setBarcode] = useState(product?.barcode || '');
  const [startQty, setStartQty] = useState('');
  const [startPrice, setStartPrice] = useState('');
  const [tried, setTried] = useState(false);
  const [askArchive, setAskArchive] = useState(false);

  const sellK = parseMoney(sell);
  const minM = min.trim() ? parseQty(min) : 0;
  const sq = startQty.trim() ? parseQty(startQty) : 0;
  const sp = startPrice.trim() ? parseMoney(startPrice) : null;
  const dupe = ledger.productList.find((p) => p.pid !== product?.pid && p.name.trim().toLowerCase() === name.trim().toLowerCase());
  const errors = {
    name: !name.trim() ? 'Вкажіть назву' : dupe ? 'Товар з такою назвою вже є' : '',
    sell: sellK === null || sellK < 0 ? 'Вкажіть ціну продажу' : '',
    min: minM === null || minM < 0 ? 'Невірне число' : '',
    start: sq === null || sq < 0 ? 'Невірна кількість' : sq && (sp === null || sp < 0) ? 'Вкажіть закупівельну ціну' : '',
  };
  const ok = !Object.values(errors).some(Boolean);
  const cats = [...new Set([...PRODUCT_CATEGORIES, ...ledger.categories])];

  async function save() {
    setTried(true);
    if (!ok) return;
    const pid = product?.pid || uid();
    const events: Parameters<typeof store.addMany>[0] = [
      {
        type: 'product.upsert',
        p: { pid, name: name.trim(), category: category.trim() || 'Без категорії', unit, sell: sellK!, min: minM || 0, barcode: barcode.trim() || undefined },
      },
    ];
    if (!product && sq && sp !== null) events.push({ type: 'purchase', p: { supplier: 'Початкові залишки', items: [{ pid, qty: sq, price: sp }] } });
    await store.addMany(events);
    toast(product ? 'Товар збережено' : 'Товар додано');
    onSaved?.(pid);
    onClose();
  }

  const e = (k: keyof typeof errors) => tried && errors[k] && <span className="err">{errors[k]}</span>;

  return (
    <>
      <Modal
        title={product ? 'Редагування товару' : 'Новий товар'}
        onClose={onClose}
        footer={
          <>
            {product && (
              <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setAskArchive(true)}>
                Прибрати з каталогу
              </button>
            )}
            <button className="btn" onClick={onClose}>
              Скасувати
            </button>
            <button className="btn primary" onClick={save}>
              Зберегти
            </button>
          </>
        }
      >
        <form
          className="form-grid"
          onSubmit={(ev) => {
            ev.preventDefault();
            save();
          }}
        >
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            Назва *
            <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Томат «Бичаче серце», 0,1 г" />
            {e('name')}
          </label>
          <label className="field">
            Категорія
            <input list="cats" value={category} onChange={(ev) => setCategory(ev.target.value)} placeholder="Овочі" />
            <datalist id="cats">
              {cats.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field">
            Одиниця
            <select value={unit} onChange={(ev) => setUnit(ev.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Ціна продажу, грн *
            <input value={sell} inputMode="decimal" onChange={(ev) => setSell(ev.target.value)} placeholder="45" />
            {e('sell')}
          </label>
          <label className="field">
            Мін. залишок ({unit})
            <input value={min} inputMode="decimal" onChange={(ev) => setMin(ev.target.value)} placeholder="10" />
            {e('min')}
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            Штрихкод
            <input value={barcode} onChange={(ev) => setBarcode(ev.target.value)} placeholder="Можна відсканувати сканером" />
          </label>
          {!product && (
            <>
              <label className="field">
                Уже є на складі ({unit})
                <input value={startQty} inputMode="decimal" onChange={(ev) => setStartQty(ev.target.value)} placeholder="0" />
                {e('start')}
              </label>
              <label className="field">
                За закупівельною ціною, грн
                <input value={startPrice} inputMode="decimal" onChange={(ev) => setStartPrice(ev.target.value)} placeholder="25" />
              </label>
            </>
          )}
          {product && (
            <div className="hint" style={{ gridColumn: '1 / -1', fontSize: 13 }}>
              Середня закупівельна ціна: <b className="num">{money(Math.round(avgCost(product)))}</b> · залишок {qty(product.stock)} {product.unit}. Вона змінюється через надходження товару.
            </div>
          )}
          <button type="submit" hidden />
        </form>
      </Modal>
      {askArchive && product && (
        <Confirm
          title="Прибрати товар з каталогу?"
          text="Товар зникне зі списків і пошуку, але історія продажів і звіти збережуться."
          ok="Прибрати"
          danger
          onClose={() => setAskArchive(false)}
          onOk={async () => {
            await store.add('product.upsert', { pid: product.pid, name: product.name, category: product.category, unit: product.unit, sell: product.sell, min: product.min, barcode: product.barcode, archived: true });
            toast('Товар прибрано з каталогу');
            onClose();
          }}
        />
      )}
    </>
  );
}

/* ---------- надходження товару ---------- */
interface PLine {
  pid: string;
  qty: string;
  price: string;
}

function PurchaseModal({ initial, onClose }: { initial: string[]; onClose: () => void }) {
  const { ledger } = useStore();
  const toast = useToast();
  const lastPrice = (pid: string) => {
    const p = ledger.products.get(pid);
    return p ? moneyInput(Math.round(avgCost(p))) : '';
  };
  const [lines, setLines] = useState<PLine[]>(initial.map((pid) => ({ pid, qty: '', price: lastPrice(pid) })));
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(todayStamp());
  const [pay, setPay] = useState<Pay>('cash');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [focusPid, setFocusPid] = useState<string | null>(initial[0] || null);

  useEffect(() => {
    if (focusPid) {
      qtyRefs.current[focusPid]?.focus();
      setFocusPid(null);
    }
  }, [focusPid, lines]);

  const suppliers = useMemo(() => [...new Set(ledger.ops.filter((o) => o.kind === 'purchase' && o.supplier && o.supplier !== 'Початкові залишки').map((o) => o.supplier!))], [ledger]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ledger.productList.filter((p) => p.barcode === q.trim() || s.split(/\s+/).every((w) => p.name.toLowerCase().includes(w))).slice(0, 6);
  }, [q, ledger]);

  function add(pid: string) {
    setLines((ls) => (ls.some((l) => l.pid === pid) ? ls : [...ls, { pid, qty: '', price: lastPrice(pid) }]));
    setQ('');
    setFocusPid(pid);
  }

  const parsed = lines.map((l) => {
    const qm = parseQty(l.qty);
    const pr = parseMoney(l.price);
    const ok = qm !== null && qm > 0 && pr !== null && pr >= 0;
    return { ...l, qm, pr, ok, total: ok ? lineTotal(qm!, pr!) : 0, p: ledger.products.get(l.pid)! };
  });
  const total = parsed.reduce((s, l) => s + l.total, 0);
  const valid = parsed.length > 0 && parsed.every((l) => l.ok);

  async function save() {
    setTried(true);
    if (!valid) return;
    const isToday = date === todayStamp();
    const [y, m, d] = date.split('-').map(Number);
    const ts = isToday ? undefined : new Date(y, m - 1, d, 12, 0).toISOString();
    await store.add('purchase', { supplier: supplier.trim() || undefined, pay, note: note.trim() || undefined, items: parsed.map((l) => ({ pid: l.pid, qty: l.qm!, price: l.pr! })) }, ts);
    toast(`Надходження збережено: ${money(total)}`);
    onClose();
  }

  return (
    <>
      <Modal
        title="Надходження товару"
        onClose={onClose}
        wide
        footer={
          <>
            <span className="num" style={{ marginRight: 'auto', fontSize: 18, fontWeight: 600, alignSelf: 'center' }}>
              Разом: {money(total)}
            </span>
            <button className="btn" onClick={onClose}>
              Скасувати
            </button>
            <button className="btn primary" onClick={save} disabled={!lines.length}>
              Зберегти надходження
            </button>
          </>
        }
      >
        <div className="form-grid">
          <label className="field">
            Постачальник
            <input list="suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Назва постачальника" />
            <datalist id="suppliers">
              {suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="field">
            Дата
            <input type="date" value={date} max={todayStamp()} onChange={(e) => setDate(e.target.value || todayStamp())} />
          </label>
          <label className="field">
            Оплата
            <select value={pay} onChange={(e) => setPay(e.target.value as Pay)}>
              <option value="cash">Готівка</option>
              <option value="card">Картка</option>
              <option value="bank">Безготівка</option>
            </select>
          </label>
        </div>

        <div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1 }}>
              Додати товар
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Назва або штрихкод"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (matches[0]) add(matches[0].pid);
                  }
                }}
              />
            </label>
            <button className="btn" onClick={() => setCreating(q.trim())}>
              + Новий товар
            </button>
          </div>
          {q.trim() && (
            <div className="suggest" style={{ marginTop: 6 }}>
              {matches.length ? (
                matches.map((p) => (
                  <button key={p.pid} onClick={() => add(p.pid)}>
                    <span>{p.name}</span>
                    <span className="num muted">
                      залишок {qty(p.stock)} {p.unit}
                    </span>
                  </button>
                ))
              ) : (
                <button onClick={() => setCreating(q.trim())}>
                  <span>Створити товар «{q.trim()}»</span>
                </button>
              )}
            </div>
          )}
        </div>

        {parsed.length > 0 ? (
          <div className="tablebox">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="r">Кількість</th>
                  <th className="r">Ціна закупівлі, грн</th>
                  <th className="r">Сума</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {parsed.map((l, i) => (
                  <tr key={l.pid}>
                    <td className="wrap">
                      {l.p?.name}
                      {tried && !l.ok && <div className="err" style={{ color: 'var(--danger)', fontSize: 12 }}>Вкажіть кількість і ціну</div>}
                    </td>
                    <td className="r">
                      <input
                        ref={(el) => (qtyRefs.current[l.pid] = el)}
                        className="input num"
                        style={{ width: 100, textAlign: 'right' }}
                        value={l.qty}
                        inputMode="decimal"
                        aria-label={`Кількість: ${l.p?.name}`}
                        onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                      />{' '}
                      <span className="muted">{l.p?.unit}</span>
                    </td>
                    <td className="r">
                      <input
                        className="input num"
                        style={{ width: 110, textAlign: 'right' }}
                        value={l.price}
                        inputMode="decimal"
                        aria-label={`Ціна закупівлі: ${l.p?.name}`}
                        onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                      />
                    </td>
                    <td className="r num">{money(l.total)}</td>
                    <td>
                      <button className="iconbtn" aria-label="Прибрати рядок" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                        {Icon.close()}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty" style={{ border: '1px dashed var(--field)', borderRadius: 12 }}>
            Додайте товари з накладної постачальника
          </div>
        )}
        <label className="field">
          Коментар
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Номер накладної тощо" />
        </label>
      </Modal>
      {creating !== null && <ProductModal product={null} initialName={creating} onClose={() => setCreating(null)} onSaved={(pid) => add(pid)} />}
    </>
  );
}

/* ---------- списання / інвентаризація ---------- */
function AdjustModal({ product, onClose }: { product: ProductState; onClose: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'writeoff' | 'count'>('writeoff');
  const [val, setVal] = useState('');
  const [reason, setReason] = useState('Брак');
  const n = parseQty(val);
  const delta = n === null ? null : mode === 'writeoff' ? -n : n - product.stock;
  const valid = n !== null && n >= 0 && delta !== 0 && !(mode === 'writeoff' && n <= 0);
  const cost = delta !== null && delta < 0 ? Math.round((avgCost(product) * -delta) / 1000) : 0;

  async function save() {
    if (!valid || delta === null) return;
    await store.add('stock.adjust', { pid: product.pid, qty: delta, reason: mode === 'count' ? `Інвентаризація${reason && reason !== 'Брак' ? `: ${reason}` : ''}` : reason || 'Списання' });
    toast(mode === 'count' ? 'Залишок виправлено' : 'Товар списано');
    onClose();
  }

  return (
    <Modal
      title={product.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            Зберегти
          </button>
        </>
      }
    >
      <div className="seg" role="group" aria-label="Дія">
        <button aria-pressed={mode === 'writeoff'} onClick={() => setMode('writeoff')}>
          Списати
        </button>
        <button aria-pressed={mode === 'count'} onClick={() => setMode('count')}>
          Інвентаризація
        </button>
      </div>
      <div className="muted">
        Зараз в обліку: <b className="num">{qty(product.stock)}</b> {product.unit} · середня закупівля {money(Math.round(avgCost(product)))}
      </div>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field">
          {mode === 'writeoff' ? `Скільки списати (${product.unit})` : `Фактично на полиці (${product.unit})`}
          <input value={val} inputMode="decimal" onChange={(e) => setVal(e.target.value)} autoFocus />
        </label>
        <label className="field">
          Причина
          <input list="reasons" value={reason} onChange={(e) => setReason(e.target.value)} />
          <datalist id="reasons">
            {['Брак', 'Зіпсовано', 'Прострочено', 'Пересорт', 'Недостача', 'Подарунок покупцю'].map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <button type="submit" hidden />
      </form>
      {delta !== null && delta !== 0 && n !== null && (
        <div className="totals">
          <div>
            <span className="muted">Зміна залишку</span>
            <span className="num">
              {delta > 0 ? '+' : '−'}
              {qty(Math.abs(delta))} {product.unit}
            </span>
          </div>
          {cost > 0 && (
            <div>
              <span className="muted">Збиток за собівартістю</span>
              <span className="num warn">{money(cost)}</span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
