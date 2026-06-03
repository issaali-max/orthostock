import { Component } from 'react';
import { C } from '../lib/constants.js';

// Catches render errors so a single bad screen never takes down the app.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[OrthoStock] render error', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, textAlign: 'center', color: C.textMid }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h3 style={{ color: C.text }}>Something went wrong</h3>
          <p style={{ fontSize: 13 }}>{String(this.state.error?.message || this.state.error)}</p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 10, padding: '8px 16px', borderRadius: 10, border: 'none', background: C.primary, color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
