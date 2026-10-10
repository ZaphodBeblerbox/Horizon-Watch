// Development only. The build replaces this file with the generated
// service worker (vite-plugin-pwa), which imports sw-push.js itself; in
// `npm run dev` this stand-in does the same so push can be tried locally.
importScripts('/sw-push.js')
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()))
