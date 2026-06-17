import { useState } from 'react';
import { useApp } from '../../app/AppProvider.jsx';
import { C } from '../../lib/constants.js';
import { Btn, Field, Input } from '../../ui/components.jsx';

export default function Login() {
  const { login, resetPassword, t, settings } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('login'); // login | forgot
  const [newPass, setNewPass] = useState('');
  const [info, setInfo] = useState('');

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const ok = await login(email, password);
      if (!ok) setError(t('wrongCreds'));
    } finally { setBusy(false); }
  };

  const doReset = async () => {
    setError(''); setInfo(''); setBusy(true);
    try {
      if (!email.trim() || newPass.length < 4) { setError(t('wrongCreds')); return; }
      const ok = await resetPassword(email, newPass);
      if (ok) { setInfo(t('passwordReset')); setMode('login'); setPassword(''); setNewPass(''); }
      else setError(t('emailNotFound'));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(160deg, ${C.primary}, ${C.primaryLight})`, padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 360, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40 }}>🦷</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.primary, margin: '6px 0 2px' }}>{settings.companyName || t('appName')}</h1>
          <div style={{ fontSize: 12, color: C.textMuted }}>{t('appSub')}</div>
        </div>
        <Field label={t('email')}>
          <Input type="email" value={email} onChange={setEmail} placeholder="admin@orthostock.ae" />
        </Field>
        {mode === 'login' ? (
          <Field label={t('password')}>
            <Input type="password" value={password} onChange={setPassword}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          </Field>
        ) : (
          <Field label={t('newPassword')} hint={t('forgotNote')}>
            <Input type="password" value={newPass} onChange={setNewPass}
              onKeyDown={(e) => { if (e.key === 'Enter') doReset(); }} />
          </Field>
        )}
        {error && <div style={{ color: C.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        {info && <div style={{ color: C.success, fontSize: 12, marginBottom: 10 }}>{info}</div>}
        <Btn onClick={mode === 'login' ? submit : doReset} disabled={busy} style={{ width: '100%', justifyContent: 'center' }} size="lg">
          {busy ? t('loading') : mode === 'login' ? t('signIn') : t('resetPassword')}
        </Btn>
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setInfo(''); }}
            style={{ background: 'none', border: 'none', color: C.primaryLight, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {mode === 'login' ? t('forgotPassword') : `← ${t('signIn')}`}
          </button>
        </div>
      </div>
    </div>
  );
}
