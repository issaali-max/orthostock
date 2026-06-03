import { useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C } from '../../lib/constants.js';
import { Btn, Field, Input } from '../../ui/components.jsx';

export default function Login() {
  const { login, t, settings } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const ok = await login(email, password);
      if (!ok) setError(t('wrongCreds'));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(160deg, ${C.primary}, ${C.primaryLight})`, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 360, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40 }}>🦷</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.primary, margin: '6px 0 2px' }}>{settings.companyName || t('appName')}</h1>
          <div style={{ fontSize: 12, color: C.textMuted }}>{t('appSub')}</div>
        </div>
        <Field label={t('email')}>
          <Input type="email" value={email} onChange={setEmail} placeholder="admin@orthostock.ae" />
        </Field>
        <Field label={t('password')}>
          <Input type="password" value={password} onChange={setPassword}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        </Field>
        {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <Btn onClick={submit} disabled={busy} style={{ width: '100%', justifyContent: 'center' }} size="lg">
          {busy ? t('loading') : t('signIn')}
        </Btn>
        <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 14 }}>
          admin@orthostock.ae · admin123
        </div>
      </div>
    </div>
  );
}
