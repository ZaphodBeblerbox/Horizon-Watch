import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app.jsx'
import './index.css'
import './styles/designSystem.css'
import { initPushNotifications } from './utils/pushNotifications.js'

// Register service worker and listen for notification-click messages
initPushNotifications().then(({ supported }) => {
    if (!supported) return
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'NOTIFICATION_CLICK' && event.data.eventId) {
            window.dispatchEvent(new CustomEvent('akili:open-alert', {
                detail: { id: event.data.eventId },
            }))
        }
    })
})

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
    this.state = { error: null, componentStack: null }
  }
  static getDerivedStateFromError(err) {
    return { error: err }
  }
  componentDidCatch(err, info) {
    console.error('=== REACT CRASH ===', err)
    console.error('=== COMPONENT STACK ===', info.componentStack)
    this.setState({ componentStack: info.componentStack })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#0a0e14', overflow: 'auto',
          fontFamily: 'monospace', color: '#e8edf2', padding: 24,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444', marginBottom: 12 }}>
            App crashed
          </div>
          <div style={{ fontSize: 13, color: '#f97316', marginBottom: 16 }}>
            {this.state.error?.message}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
            Error stack:
          </div>
          <pre style={{ fontSize: 10, color: '#4a6080', marginBottom: 20, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {this.state.error?.stack}
          </pre>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
            Component stack (screenshot this):
          </div>
          <pre style={{ fontSize: 11, color: '#fbbf24', whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 24 }}>
            {this.state.componentStack}
          </pre>
          <button
            onClick={() => { localStorage.removeItem('akili_tabs'); window.location.reload() }}
            style={{ padding: '8px 20px', background: '#0d9488', border: 'none', borderRadius: 4, color: '#fff', fontSize: 13, cursor: 'pointer' }}
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
