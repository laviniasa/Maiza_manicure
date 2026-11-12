// Driver de TESTE: executa consultas pelo psql local, sem o pacote pg.
// Uso: DB_DRIVER=psql PGDATABASE=<banco> node server/index.js
import { spawnSync } from 'node:child_process';

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function interpolate(text, params) {
  return text.replace(/\$(\d+)/g, (_, i) => literal(params[Number(i) - 1]));
}

function psql(sql, csv) {
  const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  if (csv) args.push('--csv');
  const r = spawnSync('psql', args, { input: sql, encoding: 'utf8' });
  if (r.status !== 0) {
    const line = (r.stderr.match(/ERROR:\s+(.*)/) || [])[1] || r.stderr;
    const m = line.match(/^([0-9A-Z]{5}): (.*)$/);
    const err = new Error(m ? m[2] : line);
    if (m) err.code = m[1];
    throw err;
  }
  return r.stdout;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, i = 0, wasQuoted = false;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; wasQuoted = true; i++; continue; }
    if (ch === ',') { row.push({ field, wasQuoted }); field = ''; wasQuoted = false; i++; continue; }
    if (ch === '\n') { row.push({ field, wasQuoted }); rows.push(row); row = []; field = ''; wasQuoted = false; i++; continue; }
    field += ch; i++;
  }
  if (field || row.length) { row.push({ field, wasQuoted }); rows.push(row); }
  return rows;
}

function convert(value, type) {
  if (value === '\\N') return null;
  if (type === 'boolean') return value === 't';
  if (/^(integer|bigint|smallint|numeric)/.test(type)) return Number(value);
  if (type === 'json' || type === 'jsonb') return JSON.parse(value);
  if (type.startsWith('timestamp')) {
    const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
    return new Date(iso).toISOString();
  }
  return value;
}

export async function query(text, params = []) {
  if (!params.length && text.includes(';')) { psql(text, false); return []; }
  const sql = interpolate(text, params).trim().replace(/;\s*$/, '');
  const desc = parseCsv(psql(`${sql} \\gdesc`, true)).slice(1).map((r) => r.map((c) => c.field));
  if (!desc.length || desc[0][0] === 'The command has no result, or the result has no columns.') {
    psql(sql, false);
    return [];
  }
  const out = parseCsv(psql(`\\pset null '\\\\N'\n${sql};`, true));
  const [, ...rows] = out;
  return rows.map((r) => Object.fromEntries(desc.map(([name, type], i) => [name, convert(r[i].field, type)])));
}
