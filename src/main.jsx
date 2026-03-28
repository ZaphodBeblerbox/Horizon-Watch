import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app.jsx'
import './index.css'

window.onerror = function(msg, src, line, col, err) {
  console.error('GLOBAL CRASH:', msg, 'at', src, line, col)
  console.error('Stack:', err?.stack)
  return false
}
window.onunhandledrejection = function(e) {
  console.error('UNHANDLED PROMISE:', e.reason)
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(err) {
    return { error: err }
  }
  componentDidCatch(err, info) {
    console.error('REACT CRASH:', err, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#0a0e14', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'monospace', color: '#e8edf2', padding: 24, gap: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#ef4444' }}>App crashed</div>
          <div style={{ fontSize: 12, color: '#f97316', maxWidth: 600, textAlign: 'center' }}>
            {this.state.error?.message}
          </div>
          <pre style={{ fontSize: 10, color: '#4a6080', maxWidth: 700, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.stack?.slice(0, 800)}
          </pre>
          <button
            onClick={() => { localStorage.removeItem('akili_tabs'); window.location.reload() }}
            style={{ marginTop: 8, padding: '8px 20px', background: '#0d9488', border: 'none', borderRadius: 4, color: '#fff', fontSize: 13, cursor: 'pointer' }}
          >
            Clear tabs + reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <ErrorBoundary><App /></ErrorBoundary>
)
