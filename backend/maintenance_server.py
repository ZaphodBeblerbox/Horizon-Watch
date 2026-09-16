"""Maintenance-mode placeholder server.

Used only during database maintenance windows, by pointing railway.json's
`deploy.startCommand` at this file instead of uvicorn. It answers every
request with 200 so the platform healthcheck keeps passing and the container
stays alive — which is what makes `railway ssh` available. Taking the
deployment down instead would remove the very shell access the maintenance
needs, since `railway ssh` requires a running container.

Crucially it opens no database connection, so SQLite has exactly one user
during the window: the maintenance session. That is the whole point — bulk
deletes and VACUUM against a ~30GB file cannot compete with live AIS ingest
for SQLite's single writer.
"""
import http.server
import os
import socketserver


class _MaintenanceHandler(http.server.BaseHTTPRequestHandler):
    def _respond(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"maintenance in progress")

    do_GET = _respond
    do_HEAD = _respond

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    socketserver.TCPServer.allow_reuse_address = True
    print(f"[maintenance] placeholder server listening on {port} — the app is NOT running")
    socketserver.TCPServer(("", port), _MaintenanceHandler).serve_forever()
