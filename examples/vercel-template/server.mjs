// Zero-dependency local dev server for the Vercel template.
//
// Serves the /public demo UI and routes /api/* to the same edge-function
// handlers Vercel runs, so `npm start` reproduces the deployed behavior
// without the Vercel CLI.
//
//   npm start            # http://localhost:3000

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function serveStatic(pathname) {
  const file = normalize(join(root, 'public', pathname));
  if (!file.startsWith(root)) return null; // path traversal guard
  try {
    const body = await readFile(file);
    return new Response(body, {
      headers: { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' },
    });
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
  let request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: body || undefined,
  });

  let response;
  if (url.pathname.startsWith('/api/')) {
    const handlerName = url.pathname.slice('/api/'.length).replace(/\.js$/, '') || 'index';
    try {
      const mod = await import(`./api/${handlerName}.js`);
      response = await mod.default(request);
    } catch {
      response = new Response(JSON.stringify({ error: 'no such route' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    response = (await serveStatic(path)) ?? new Response('Not found', { status: 404 });
  }

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`MortgageVendorOS template running at http://localhost:${PORT}`);
});
