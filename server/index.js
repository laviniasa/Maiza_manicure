import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, migrate } from './db.js';
import { currentUser, ensureAdmin } from './auth.js';
import { routes, HttpError } from './routes.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

// Rotas compiladas: '/api/clients/:id' -> regex com grupo "id"
const compiled = routes.map(([method, path, handler, opts = {}]) => ({
  method,
  handler,
  public: Boolean(opts.public),
  regex: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'),
}));

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

const sendJson = (res, status, data) =>
  send(res, status, JSON.stringify(data ?? null), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new HttpError(413, 'Conteúdo muito grande.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido.'); }
}

function dbErrorMessage(err) {
  switch (err.code) {
    case '23P01': return [409, 'Já existe um horário marcado nesse período.'];
    case 'P0001': return [400, err.message];
    case '23503': return [400, 'Registro relacionado não encontrado.'];
    case '23514':
    case '23502':
    case '22P02': return [400, 'Dados inválidos.'];
    default: return null;
  }
}

async function handleApi(req, res, url) {
  const route = compiled.find((r) => r.method === req.method && r.regex.test(url.pathname));
  if (!route) return sendJson(res, 404, { error: 'Rota não encontrada.' });

  // Proteção contra requisições de outros sites (CSRF)
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') {
    return sendJson(res, 403, { error: 'Requisição não permitida.' });
  }

  try {
    const user = route.public ? null : await currentUser(req);
    if (!route.public && !user) return sendJson(res, 401, { error: 'Faça login para continuar.' });
    const body = req.method === 'GET' ? {} : await readBody(req);
    const params = route.regex.exec(url.pathname).groups || {};
    const result = await route.handler({ req, res, url, user, body, params });
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    const mapped = dbErrorMessage(err);
    if (mapped) return sendJson(res, mapped[0], { error: mapped[1] });
    console.error(err);
    sendJson(res, 500, { error: 'Erro no servidor. Tente de novo.' });
  }
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido');
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(PUBLIC_DIR, path));
  if (!file.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) return send(res, 403, 'Proibido');
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error();
    const ext = extname(file);
    const longCache = ext === '.png' || ext === '.svg';
    send(res, 200, req.method === 'HEAD' ? '' : await readFile(file), {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': longCache ? 'public, max-age=604800' : 'no-cache',
    });
  } catch {
    send(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) handleApi(req, res, url);
  else serveStatic(req, res, url);
});

await connect();
await migrate();
await ensureAdmin();
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
