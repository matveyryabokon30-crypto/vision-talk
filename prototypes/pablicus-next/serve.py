"""Serve only the exact public files used by this prototype, on loopback."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import argparse

ROOT = Path(__file__).resolve().parents[2]
FILES = {
    '/prototypes/pablicus-next/': ('prototypes/pablicus-next/index.html', 'text/html'),
    '/prototypes/pablicus-next/index.html': ('prototypes/pablicus-next/index.html', 'text/html'),
    '/prototypes/pablicus-next/app.js': ('prototypes/pablicus-next/app.js', 'text/javascript'),
    '/prototypes/pablicus-next/shell.css': ('prototypes/pablicus-next/shell.css', 'text/css'),
    '/library/pablicus-ui/edge-picker.js': ('library/pablicus-ui/edge-picker.js', 'text/javascript'),
    '/library/pablicus-ui/notch-geometry.js': ('library/pablicus-ui/notch-geometry.js', 'text/javascript'),
    '/library/pablicus-ui/foundation.css': ('library/pablicus-ui/foundation.css', 'text/css'),
    '/vendor/upstream/figma-sds/src/theme.css': ('vendor/upstream/figma-sds/src/theme.css', 'text/css'),
}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        entry = FILES.get(urlsplit(self.path).path)
        if entry is None:
            self.send_error(404)
            return
        path, mime = entry
        data = (ROOT / path).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8129)
    args = parser.parse_args()
    print(f'Prototype: http://127.0.0.1:{args.port}/prototypes/pablicus-next/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
