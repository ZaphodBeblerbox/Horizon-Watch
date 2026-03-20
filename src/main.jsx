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

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode><App /></React.StrictMode>
)
