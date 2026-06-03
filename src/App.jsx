import { useApp } from './app/AppProvider.jsx';
import ErrorBoundary from './app/ErrorBoundary.jsx';
import Shell from './app/Shell.jsx';
import Login from './features/auth/Login.jsx';
import { Toast } from './ui/components.jsx';
import { C } from './lib/constants.js';

export default function App() {
  const { user, loading, toast } = useApp();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textMuted }}>
        Loading…
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {user ? <Shell /> : <Login />}
      <Toast toast={toast} />
    </ErrorBoundary>
  );
}
