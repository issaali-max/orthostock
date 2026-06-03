import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C } from '../../lib/constants.js';
import { Btn, Card, Field, Input, PageHeader, Select } from '../../ui/components.jsx';
import { resetStore } from '../../db/db.js';
import { num } from '../../lib/money.js';

export default function Settings() {
  const { t, settings, updateSettings, setLang, loading } = useApp();
  const [form, setForm] = useState(settings);

  useEffect(() => { setForm(settings); }, [settings]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    await updateSettings({
      companyName: form.companyName || 'OrthoStock',
      usdRate: num(form.usdRate, 3.6725) || 3.6725,
      taxEnabled: !!form.taxEnabled,
      taxRate: num(form.taxRate, 5),
      lang: form.lang || 'ar',
    });
    setLang(form.lang || 'ar');
  };

  const doReset = async () => {
    if (!window.confirm('Reset the in-memory dev store to seed data?')) return;
    await resetStore();
    window.location.reload();
  };

  return (
    <div>
      <PageHeader title={t('settings')} />
      <Card>
        <Field label={t('companyName')} required>
          <Input value={form.companyName} onChange={(v) => set('companyName', v)} />
        </Field>
        <Field label={t('usdRate')} hint="1 USD = ? AED">
          <Input type="number" value={form.usdRate} onChange={(v) => set('usdRate', v)} />
        </Field>
        <Field label={t('language')}>
          <Select value={form.lang} onChange={(v) => set('lang', v)} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
        </Field>
        <Field label={t('taxEnabled')}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textMid }}>
            <input type="checkbox" checked={!!form.taxEnabled} onChange={(e) => set('taxEnabled', e.target.checked)} />
            {form.taxEnabled ? t('active') : t('inactive')}
          </label>
        </Field>
        {form.taxEnabled && (
          <Field label={t('taxRate')}>
            <Input type="number" value={form.taxRate} onChange={(v) => set('taxRate', v)} />
          </Field>
        )}
        <Btn onClick={save} disabled={loading} size="lg" style={{ marginTop: 6 }}>{t('save')}</Btn>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMid, marginBottom: 8 }}>Developer</div>
        <Btn variant="outline" onClick={doReset}>Reset dev data (memory mode)</Btn>
      </Card>
    </div>
  );
}
