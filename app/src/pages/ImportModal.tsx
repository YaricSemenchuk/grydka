import { useState } from 'react';
import { money, qty } from '../core/format';
import { store } from '../core/store';
import { PRODUCT_CATEGORIES, type EventType, type Payloads } from '../core/types';
import type { ImportPlan } from '../excel';
import { todayStamp } from '../platform';
import { Modal, useStore, useToast } from '../ui';

export function ImportModal({ plan, onClose, onDone }: { plan: ImportPlan; onClose: () => void; onDone: (newPids: string[], hadNoPrice: boolean) => void }) {
  const { ledger } = useStore();
  const toast = useToast();
  const invoice = plan.kind === 'invoice';
  const [supplier, setSupplier] = useState(plan.supplier || '');
  const [date, setDate] = useState(plan.date && plan.date <= todayStamp() ? plan.date : todayStamp());
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('');
  const newOnes = plan.rows.filter((r) => r.isNew);
  const cats = [...new Set([...PRODUCT_CATEGORIES, ...ledger.categories])];
  const suppliers = [...new Set(ledger.ops.filter((o) => o.kind === 'purchase' && o.supplier && o.supplier !== 'Початкові залишки').map((o) => o.supplier!))];

  async function run() {
    const events: { type: EventType; p: Payloads[EventType]; ts?: string }[] = plan.products.map((p) => ({
      type: 'product.upsert',
      p: category && p.category === 'Без категорії' ? { ...p, category } : p,
    }));
    if (plan.stock.length) {
      const [y, m, d] = date.split('-').map(Number);
      const ts = date === todayStamp() ? undefined : new Date(y, m - 1, d, 12, 0).toISOString();
      events.push({
        type: 'purchase',
        p: {
          supplier: invoice ? supplier.trim() || undefined : 'Початкові залишки',
          pay: 'bank',
          note: note.trim() || (invoice ? 'Імпорт накладної' : 'Імпорт з Excel'),
          items: plan.stock,
        },
        ts,
      });
    }
    await store.addMany(events);
    toast(invoice ? `Накладну збережено: ${plan.stock.length} позицій на ${money(plan.stockValue)}` : `Імпортовано товарів: ${plan.products.length}`);
    onDone(
      plan.rows.map((r) => r.pid),
      plan.withoutPrice > 0,
    );
  }

  return (
    <Modal
      title={invoice ? 'Імпорт накладної постачальника' : 'Імпорт товарів'}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="num" style={{ marginRight: 'auto', alignSelf: 'center', fontWeight: 600, fontSize: 17 }}>
            {plan.stock.length ? `Разом: ${money(plan.stockValue)}` : ''}
          </span>
          <button className="btn" onClick={onClose}>
            Скасувати
          </button>
          <button className="btn primary" disabled={!plan.products.length} onClick={run}>
            {invoice ? 'Оприбуткувати накладну' : 'Імпортувати'}
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 18 }}>
        <span>
          Позицій: <b>{plan.rows.length}</b>
        </span>
        <span>
          Нових товарів: <b>{plan.created}</b>
        </span>
        <span>
          Уже в каталозі: <b>{plan.updated}</b>
        </span>
        {plan.withoutPrice > 0 && <span className="tag expense">без ціни продажу: {plan.withoutPrice}</span>}
      </div>

      {invoice && (
        <div className="form-grid">
          <label className="field">
            Постачальник
            <input list="imp-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Назва постачальника" />
            <datalist id="imp-suppliers">
              {suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="field">
            Дата накладної
            <input type="date" value={date} max={todayStamp()} onChange={(e) => setDate(e.target.value || todayStamp())} />
          </label>
          <label className="field">
            Коментар
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="№ накладної" />
          </label>
        </div>
      )}
      {newOnes.some((r) => plan.products.find((p) => p.pid === r.pid)?.category === 'Без категорії') && (
        <label className="field" style={{ maxWidth: 320 }}>
          Категорія для нових товарів без категорії
          <input list="imp-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Без категорії" />
          <datalist id="imp-cats">
            {cats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      )}

      <div className="tablebox" style={{ maxHeight: '44vh', overflowY: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Товар</th>
              <th className="r">Кількість</th>
              <th className="r">Закупівля</th>
              <th className="r">Сума</th>
              <th className="r">Ціна продажу</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r) => (
              <tr key={r.pid}>
                <td className="wrap">
                  {r.name} {r.isNew ? <span className="tag sale">новий</span> : null}
                </td>
                <td className="r num">{r.qty !== null ? `${qty(r.qty)} ${r.unit}` : '—'}</td>
                <td className="r num">{r.buy !== null ? money(r.buy) : '—'}</td>
                <td className="r num">{r.qty !== null && r.buy !== null ? money(Math.round((r.qty * r.buy) / 1000)) : '—'}</td>
                <td className="r num">{r.sell ? money(r.sell) : <span className="warn">немає</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.skipped.length > 0 && (
        <div className="warn" style={{ fontSize: 13 }}>
          Пропущено {plan.skipped.length}: {plan.skipped.slice(0, 4).join('; ')}
          {plan.skipped.length > 4 ? '…' : ''}
        </div>
      )}
      <div className="hint" style={{ fontSize: 12 }}>
        {invoice
          ? 'Товари без ціни продажу створяться з нульовою ціною — одразу після імпорту можна встановити націнку для всіх. Товари з тим самим кодом або назвою оновляться, а не задублюються.'
          : 'Колонки: Назва, Категорія, Од., Ціна продажу, Ціна закупівлі, Залишок, Мін. залишок, Штрихкод, Артикул.'}
      </div>
    </Modal>
  );
}
