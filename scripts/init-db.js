import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { parseRegistrationLimit } from '../src/validation.js';

const { Pool } = pg;
const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/schema.sql');
const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const runtimePassword = process.env.APP_DB_PASSWORD;
const eventKey = process.env.EVENT_KEY || 'encontro-janeiro-2027';
const eventTitle = process.env.EVENT_TITLE || 'Encontro de Ideias';
const eventMonth = process.env.EVENT_MONTH_START || '2027-01-01';
const exactDate = process.env.EVENT_DATE || null;
const startTime = process.env.EVENT_START_TIME || '11:00';
const venueName = process.env.EVENT_VENUE || 'Clube Canto do Rio';
const capacity = parseRegistrationLimit(process.env.REGISTRATION_LIMIT);

if (!migrationUrl) throw new Error('DATABASE_MIGRATION_URL não configurada.');
if (!runtimePassword || !/^[A-Fa-f0-9]{64}$/.test(runtimePassword)) throw new Error('APP_DB_PASSWORD deve conter 32 bytes em hexadecimal.');
if (!/^\d{4}-\d{2}-01$/.test(eventMonth) || Number.isNaN(Date.parse(`${eventMonth}T00:00:00Z`))) {
  throw new Error('EVENT_MONTH_START deve ser o primeiro dia do mês, no formato AAAA-MM-01.');
}
if (exactDate && (!/^\d{4}-\d{2}-\d{2}$/.test(exactDate) || !Date.parse(`${exactDate}T00:00:00Z`) || exactDate.slice(0, 7) !== eventMonth.slice(0, 7))) {
  throw new Error('EVENT_DATE precisa ser uma data válida dentro de EVENT_MONTH_START.');
}
if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime)) throw new Error('EVENT_START_TIME precisa estar no formato HH:MM.');
if (eventKey.length > 100 || !eventTitle.trim() || eventTitle.length > 120 || !venueName.trim() || venueName.length > 160) {
  throw new Error('Revise EVENT_KEY, EVENT_TITLE e EVENT_VENUE.');
}

const migrationPool = new Pool({ connectionString: migrationUrl, max: 1, connectionTimeoutMillis: 5000 });
let client;
try {
  client = await migrationPool.connect();
  await client.query("SELECT set_config('app.runtime_password', $1, false)", [runtimePassword]);
  const schema = await fs.readFile(schemaPath, 'utf8');
  await client.query(schema);
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.event_key', $1, true)", [eventKey]);
  await client.query(
    `INSERT INTO events (event_key, title, event_month, event_date, start_time, venue_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (event_key) DO UPDATE SET
       title = EXCLUDED.title,
       event_month = EXCLUDED.event_month,
       event_date = EXCLUDED.event_date,
       start_time = EXCLUDED.start_time,
       venue_name = EXCLUDED.venue_name`,
    [eventKey, eventTitle.trim(), eventMonth, exactDate, startTime, venueName.trim()]
  );
  await client.query(
    `INSERT INTO event_capacity (event_key, capacity, registered_count)
     VALUES ($1, $2, (SELECT COUNT(*)::int FROM registrations WHERE event_key = $1))
     ON CONFLICT (event_key) DO UPDATE SET capacity = EXCLUDED.capacity`,
    [eventKey, capacity]
  );
  await client.query('COMMIT');
  console.log(`Schema aplicado. Evento configurado: ${eventTitle.trim()} — ${eventMonth.slice(0, 7)} às ${startTime} — ${venueName.trim()}.`);
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error('Falha ao preparar PostgreSQL:', error.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await migrationPool.end();
}
