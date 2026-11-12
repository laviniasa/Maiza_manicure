import { readFile } from 'node:fs/promises';

let driver;

/** Conecta ao Postgres (variável DATABASE_URL). */
export async function connect() {
  if (process.env.DB_DRIVER === 'psql') {
    // apenas para testes locais sem o pacote pg
    driver = await import('../test/psql-driver.js');
    return;
  }
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(1082, (v) => v);              // date -> 'YYYY-MM-DD'
  pg.types.setTypeParser(1700, (v) => parseFloat(v));  // numeric -> número
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  driver = { query: async (text, params) => (await pool.query(text, params)).rows };
}

/** Executa uma consulta parametrizada e devolve as linhas. */
export function query(text, params = []) {
  return driver.query(text, params);
}

export async function one(text, params) {
  return (await query(text, params))[0] ?? null;
}

export async function migrate() {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await query(sql);
}
