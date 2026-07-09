import { useEffect, useState } from 'react';
import { C, RADIUS, SHADOW } from '../lib/constants.js';

// ── Button ──
export function Btn({ children, onClick, variant = 'primary', size = 'md', disabled, style, type, ...rest }) {
  const palette = {
    primary: { bg: C.primary, fg: '#fff', bd: C.primary },
    light: { bg: C.surfaceDark, fg: C.primary, bd: C.surfaceDark },
    danger: { bg: C.danger, fg: '#fff', bd: C.danger },
    success: { bg: C.success, fg: '#fff', bd: C.success },
    ghost: { bg: 'transparent', fg: C.primaryMid, bd: 'transparent' },
    outline: { bg: '#fff', fg: C.primary, bd: C.border },
  }[variant] || {};
  const pad = size === 'sm' ? '6px 12px' : size === 'lg' ? '12px 20px' : '9px 16px';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: palette.bg, color: palette.fg, border: `1px solid ${palette.bd}`,
        borderRadius: 10, padding: pad, fontSize: size === 'sm' ? 12 : 13, fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
        transition: 'transform .08s, opacity .15s', display: 'inline-flex',
        alignItems: 'center', gap: 6, ...style,
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.97)'; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Field wrapper (label + control) ──
export function Field({ label, required, children, hint }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 5 }}>
        {label}{required && <span style={{ color: C.danger }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ display: 'block', fontSize: 11, color: C.textMuted, marginTop: 4 }}>{hint}</span>}
    </label>
  );
}

const controlStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${C.border}`,
  fontSize: 16, color: C.text, background: '#fff', outline: 'none',
};

export function Input({ value, onChange, type = 'text', placeholder, style, ...rest }) {
  // For number fields, a 0 / empty value is shown as a BLANK with a "0" placeholder, so the
  // user can type the amount straight away without first selecting and deleting a pre-filled
  // 0. Empty therefore means 0 (callers convert with num()). Non-zero values show normally.
  const isNum = type === 'number';
  const display = isNum
    ? (value === 0 || value === '' || value == null ? '' : value)
    : (value ?? '');
  return (
    <input
      type={type} value={display} placeholder={placeholder ?? (isNum ? '0' : undefined)}
      onChange={(e) => onChange?.(e.target.value)}
      style={{ ...controlStyle, ...style }}
      onFocus={(e) => { e.target.style.borderColor = C.primaryLight; }}
      onBlur={(e) => { e.target.style.borderColor = C.border; }}
      {...rest}
    />
  );
}

export function Textarea({ value, onChange, placeholder, rows = 3, style }) {
  return (
    <textarea
      value={value ?? ''} rows={rows} placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      style={{ ...controlStyle, resize: 'vertical', ...style }}
    />
  );
}

export function Select({ value, onChange, options = [], placeholder, style }) {
  return (
    <select
      value={value ?? ''} onChange={(e) => onChange?.(e.target.value)}
      style={{ ...controlStyle, appearance: 'auto', ...style }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const val = typeof o === 'object' ? o.value : o;
        const lbl = typeof o === 'object' ? o.label : o;
        return <option key={val} value={val}>{lbl}</option>;
      })}
    </select>
  );
}

// ── Card ──
export function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: C.surface, borderRadius: RADIUS, boxShadow: SHADOW,
      border: `1px solid ${C.border}`, padding: 14, ...style,
    }}>
      {children}
    </div>
  );
}

// ── Badge ──
export function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: { bg: C.surfaceDark, fg: C.textMid },
    success: { bg: '#E3F3EA', fg: C.success },
    warning: { bg: '#FBEEDD', fg: C.warning },
    danger: { bg: '#F8E1E1', fg: C.danger },
    info: { bg: '#E4EFFB', fg: C.primaryMid },
  }[tone] || {};
  return (
    <span style={{
      background: tones.bg, color: tones.fg, fontSize: 11, fontWeight: 700,
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

// ── SearchBar ──
export function SearchBar({ value, onChange, placeholder }) {
  return (
    <div style={{ position: 'relative', marginBottom: 12 }}>
      <span style={{ position: 'absolute', insetInlineStart: 12, top: 9, fontSize: 14, opacity: 0.5 }}>🔍</span>
      <input
        value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange?.(e.target.value)}
        style={{ ...controlStyle, paddingInlineStart: 34, background: C.surfaceAlt }}
      />
    </div>
  );
}

// ── Modal ──
export function Modal({ open, onClose, title, children, footer, width = 460, dismissable = false }) {
  // Lock the BODY scroll while open so swiping scrolls only the modal content.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <div
      // `dismissable` modals (read-only views) close when the grey overlay itself is
      // tapped; input modals leave it off so unsaved typing isn't lost.
      onClick={dismissable ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(14,29,46,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: 0, paddingTop: 'calc(env(safe-area-inset-top) + 16px)', boxSizing: 'border-box',
        overscrollBehavior: 'contain',
      }}
    >
      <div
        className="modal-sheet"
        style={{
          background: '#fff', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: width,
          // Bound by the overlay's padded box (real viewport − top safe area), so the
          // header with the × button can never be pushed off-screen by a long list.
          maxHeight: '100%',
          display: 'flex', flexDirection: 'column', boxShadow: '0 -8px 30px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 16px', borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          <strong style={{ fontSize: 15, color: C.text }}>{title}</strong>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: C.textMuted }}>×</button>
        </div>
        <div className="modal-body" style={{ paddingTop: 16, paddingInline: 16, paddingBottom: footer ? 16 : 'calc(16px + env(safe-area-inset-bottom))', overflowY: 'auto', flex: 1, minHeight: 0, WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>{children}</div>
        {footer && (
          <div style={{ padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Toast (lightweight, self-dismissing) ──
export function Toast({ toast }) {
  if (!toast) return null;
  const tones = { success: C.success, error: C.danger, info: C.primaryMid };
  return (
    <div style={{
      position: 'fixed', bottom: 90, insetInline: 0, display: 'flex', justifyContent: 'center', zIndex: 2000, pointerEvents: 'none',
    }}>
      <div style={{
        background: tones[toast.type] || C.text, color: '#fff', padding: '10px 18px',
        borderRadius: 999, fontSize: 13, fontWeight: 600, boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
        maxWidth: '90%',
      }}>
        {toast.message}
      </div>
    </div>
  );
}

// ── CurrencyToggle (display only) ──
export function CurrencyToggle({ currency, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        border: `1px solid ${C.border}`, background: '#fff', borderRadius: 999,
        padding: '4px 10px', fontSize: 12, fontWeight: 700, color: C.primary, cursor: 'pointer',
      }}
    >
      {currency} ⇄
    </button>
  );
}

// ── EmptyState ──
export function EmptyState({ icon = '📭', text }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: C.textMuted }}>
      <div style={{ fontSize: 36, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13 }}>{text}</div>
    </div>
  );
}

// ── AttributePicker ──
// Renders one Select per category attribute; lets you add a new option inline.
export function AttributePicker({ attributes = [], values = {}, onChange, lang = 'en', onAddOption, t }) {
  if (!attributes.length) {
    return <div style={{ fontSize: 12, color: C.textMuted, padding: '4px 0' }}>{t ? t('noAttributes') : 'No attributes'}</div>;
  }
  return (
    <div>
      {attributes.map((attr) => (
        <Field key={attr.key} label={lang === 'ar' ? attr.labelAr : attr.labelEn}>
          <div style={{ display: 'flex', gap: 6 }}>
            <Select
              value={values[attr.key] ?? ''}
              onChange={(v) => onChange({ ...values, [attr.key]: v })}
              options={attr.options || []}
              placeholder="—"
              style={{ flex: 1 }}
            />
            <AddOptionButton onAdd={(opt) => onAddOption?.(attr.key, opt)} label={t ? t('addOption') : '+'} />
          </div>
        </Field>
      ))}
    </div>
  );
}

function AddOptionButton({ onAdd, label }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  if (editing) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <Input value={val} onChange={setVal} placeholder="…" style={{ width: 80 }} />
        <Btn size="sm" onClick={() => { if (val.trim()) onAdd(val.trim()); setVal(''); setEditing(false); }}>✓</Btn>
      </div>
    );
  }
  return <Btn size="sm" variant="light" onClick={() => setEditing(true)} title={label}>＋</Btn>;
}

// ── Section header with action button ──
export function PageHeader({ title, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0 }}>{title}</h2>
      {action}
    </div>
  );
}

// ── Payment recorder (shared by Invoices + Customer profile) ──
// Presentational: calls onRecord(amount). `cur` formats currency, `t` translates.
export function PaymentModal({ open, onClose, invoice, t, cur, onRecord }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  useEffect(() => { if (open) { setAmount(''); setMethod('cash'); } }, [open, invoice?.id]);
  if (!invoice) return null;
  const total = Number(invoice.total) || 0;
  const paid = Number(invoice.paidAmount) || 0;
  const remaining = Math.round((total - paid) * 100) / 100;
  const history = invoice.payments || [];
  const submit = () => { const a = Number(amount) || 0; if (a > 0) { onRecord(a, method); onClose(); } };
  const mLabel = { cash: t('payCash'), transfer: t('payTransfer'), cheque: t('payCheque'), card: t('payCard') };
  const mIcon = { cash: '💵', transfer: '🏦', cheque: '🧾', card: '💳' };
  return (
    <Modal open={open} onClose={onClose} title={`${t('recordPayment')} · ${invoice.invoiceNumber || ''}`}
      footer={<><Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn><Btn onClick={submit} disabled={!(Number(amount) > 0)}>{t('save')}</Btn></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: C.surfaceAlt, borderRadius: 10, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{cur(total)}</div>
          <div style={{ fontSize: 10, color: C.textMuted }}>{t('finalTotal')}</div>
        </div>
        <div style={{ background: '#E9F6EF', borderRadius: 10, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.success }}>{cur(paid)}</div>
          <div style={{ fontSize: 10, color: C.textMuted }}>{t('paidAmount')}</div>
        </div>
        <div style={{ background: remaining > 0 ? '#FBECEC' : '#E9F6EF', borderRadius: 10, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: remaining > 0 ? C.danger : C.success }}>{cur(remaining)}</div>
          <div style={{ fontSize: 10, color: C.textMuted }}>{t('remaining')}</div>
        </div>
      </div>
      {remaining > 0 ? (
        <>
          <Field label={t('paymentAmount')}>
            <Input type="number" value={amount} placeholder={String(remaining)} onChange={(v) => setAmount(v === '' ? '' : Math.min(Math.max(0, Number(v) || 0), remaining))} />
          </Field>
          <Field label={t('paymentMethod')}>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['cash', `🗄️ ${t('toDrawer') || 'الدرج (كاش)'}`], ['transfer', `🏦 ${t('toBank') || 'الحساب البنكي'}`]].map(([m, label]) => (
                <button key={m} onClick={() => setMethod(m)} style={{ flex: 1, border: `1.5px solid ${method === m ? C.primary : C.border}`, background: method === m ? C.primary : '#fff', color: method === m ? '#fff' : C.textMid, borderRadius: 10, padding: '11px 6px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{label}</button>
              ))}
            </div>
          </Field>
        </>
      ) : <div style={{ color: C.success, fontWeight: 700, textAlign: 'center', padding: 8 }}>✓ {t('paid')}</div>}
      {history.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.textMid, marginBottom: 6 }}>{t('paymentsHistory')}</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {history.map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, fontSize: 12, color: C.textMid, background: C.surfaceAlt, borderRadius: 8, padding: '5px 9px' }}>
                <span>{p.date}</span>
                <span style={{ flex: 1, fontSize: 11, color: C.textMuted }}>{p.method ? `${mIcon[p.method] || ''} ${mLabel[p.method] || p.method}` : ''}{p.method === 'cheque' && p.chequeStatus !== 'cleared' ? ' ⏳' : ''}</span>
                <span style={{ fontWeight: 700, color: p.method === 'cheque' && p.chequeStatus !== 'cleared' ? C.warning : C.success }}>+{cur(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── ProductChips: the product-group picker used everywhere materials are chosen ──
// Replaces the old one-line horizontal strip (groups off-screen were invisible).
// All groups WRAP into visible rows; when there are many (e.g. wires), a quick
// filter box appears and narrows the chips as you type. Selected chip stays first-class.
export function ProductChips({ items, value, onChange, color = C.primaryMid, filterThreshold = 9 }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  // Same alphabetical order the Catalogue uses, so groups appear where expected.
  const ordered = items.slice().sort((a, b) => (a.nameEn || a.name || '').localeCompare(b.nameEn || b.name || '', 'en'));
  const shown = needle ? ordered.filter((p) => `${p.nameEn || ''} ${p.name || ''}`.toLowerCase().includes(needle)) : ordered;
  return (
    <div style={{ marginBottom: 8 }}>
      {items.length > filterThreshold && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 تصفية المجموعات…"
          style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10, padding: '7px 10px', fontSize: 16, marginBottom: 6, outline: 'none', background: '#fff', color: C.text }} />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 132, overflowY: 'auto', paddingBottom: 2 }}>
        {shown.length === 0
          ? <div style={{ fontSize: 11.5, color: C.textMuted, padding: '4px 2px' }}>لا مجموعات مطابقة</div>
          : shown.map((p) => {
            const on = value === p.id;
            return (
              <button key={p.id} onClick={() => onChange(p.id)} style={{
                border: `1.5px solid ${on ? color : C.border}`, background: on ? color : '#fff',
                color: on ? '#fff' : C.textMid, borderRadius: 999, padding: '6px 12px',
                fontSize: 12.5, fontWeight: 700, cursor: 'pointer', maxWidth: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{p.icon} {p.nameEn}</button>
            );
          })}
      </div>
    </div>
  );
}
