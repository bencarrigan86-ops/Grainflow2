"""Dev server for docs/ that disables all caching.

Plain `python -m http.server` sends no Cache-Control header, so browsers fall
back to heuristic caching — which is exactly what caused this app's own
JS/CSS edits to keep showing up stale on a phone that had loaded it before.
This serves the same files but forces every response to be revalidated.
"""
import http.server
import os
import socketserver

PORT = 8756
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class ReusableTCPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with ReusableTCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Serving {DIRECTORY} at http://0.0.0.0:{PORT} (no-cache)")
        httpd.serve_forever()
