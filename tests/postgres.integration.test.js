import test, { after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_DATABASE_MIGRATION_URL;
const enabled = Boolean(runtimeUrl && migrationUrl);
const migrationPool = enabled ? new Pool({ connectionString: migrationUrl, max: 2 }) : null;
const runtimePool = enabled ? new Pool({ connectionString: runtimeUrl, max: 4 }) : null;
const fixtureKeys = new Set();
const fixtureSessionHashes = new Set();

async function createEvent({ capacity = null } = {}) {
  const eventKey = `test-${crypto.randomUUID()}`;
  fixtureKeys.add(eventKey);

  await migrationPool.query(
    `INSERT INTO events (event_key, title, event_month, start_time, venue_name)
     VALUES ($1, 'Evento de teste', DATE '2027-01-01', TIME '11:00', 'Local de teste')`,
    [eventKey]
  );
  await migrationPool.query(
    'INSERT INTO event_capacity (event_key, capacity, registered_count) VALUES ($1, $2, 0)',
    [eventKey, capacity]
  );

  return eventKey;
}

async function createRegistration(eventKey, email) {
  const client = await migrationPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.event_key', $1, true)", [eventKey]);
    await client.query(
      `INSERT INTO registrations
         (id, event_key, full_name, email, phone, consent_at, consent_version)
       VALUES ($1, $2, 'Pessoa de teste', $3, '21999999999', NOW(), 'test')`,
      [crypto.randomUUID(), eventKey, email]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function withRuntimeTransaction(eventKey, sessionHash, operation) {
  const client = await runtimePool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.event_key', $1, true), set_config('app.session_hash', $2, true)",
      [eventKey, sessionHash]
    );
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function insertAsRuntime(eventKey, email) {
  return withRuntimeTransaction(eventKey, '', client => client.query(
    `INSERT INTO registrations
       (id, event_key, full_name, email, phone, consent_at, consent_version)
     VALUES ($1, $2, 'Inscrição de teste', $3, '21999999999', NOW(), 'test')`,
    [crypto.randomUUID(), eventKey, email]
  ));
}

before({ skip: !enabled }, async () => {
  const { rows } = await runtimePool.query('SELECT current_user');
  assert.equal(rows[0].current_user, 'event_app', 'TEST_DATABASE_URL deve usar o papel da aplicação');
});

afterEach({ skip: !enabled }, async () => {
  if (fixtureKeys.size === 0) return;
  const keys = [...fixtureKeys];
  const sessionHashes = [...fixtureSessionHashes];
  fixtureKeys.clear();
  fixtureSessionHashes.clear();
  await migrationPool.query('DELETE FROM registrations WHERE event_key = ANY($1::text[])', [keys]);
  if (sessionHashes.length > 0) {
    await migrationPool.query('DELETE FROM admin_sessions WHERE token_hash = ANY($1::char(64)[])', [sessionHashes]);
  }
  await migrationPool.query('DELETE FROM event_capacity WHERE event_key = ANY($1::text[])', [keys]);
  await migrationPool.query('DELETE FROM events WHERE event_key = ANY($1::text[])', [keys]);
});

after(async () => {
  await Promise.all([migrationPool?.end(), runtimePool?.end()]);
});

test('RLS limita eventos e inscrições e exige sessão administrativa ativa para leitura', {
  skip: enabled ? false : 'Configure TEST_DATABASE_URL e TEST_DATABASE_MIGRATION_URL para executar testes PostgreSQL.'
}, async () => {
  const eventA = await createEvent();
  const eventB = await createEvent();
  const emailA = `${crypto.randomUUID()}@test.invalid`;
  const emailB = `${crypto.randomUUID()}@test.invalid`;
  await createRegistration(eventA, emailA);
  await createRegistration(eventB, emailB);

  const sessionHash = crypto.randomBytes(32).toString('hex');
  fixtureSessionHashes.add(sessionHash);
  const result = await withRuntimeTransaction(eventA, '', async client => {
    const visibleEvents = await client.query('SELECT event_key FROM events ORDER BY event_key');
    assert.deepEqual(visibleEvents.rows.map(row => row.event_key), [eventA]);

    const hiddenRegistrations = await client.query('SELECT email FROM registrations');
    assert.equal(hiddenRegistrations.rowCount, 0);

    await client.query(
      'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, NOW() + INTERVAL \'1 hour\')',
      [sessionHash]
    );
    await client.query("SELECT set_config('app.session_hash', $1, true)", [sessionHash]);
    const visibleRegistrations = await client.query('SELECT email FROM registrations ORDER BY email');
    assert.deepEqual(visibleRegistrations.rows.map(row => row.email), [emailA]);

    await client.query("SELECT set_config('app.event_key', $1, true)", [eventB]);
    const otherEventRegistrations = await client.query('SELECT email FROM registrations ORDER BY email');
    assert.deepEqual(otherEventRegistrations.rows.map(row => row.email), [emailB]);

    const expiredHash = crypto.randomBytes(32).toString('hex');
    await client.query("SELECT set_config('app.session_hash', $1, true)", [expiredHash]);
    await client.query(
      'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, NOW() - INTERVAL \'1 hour\')',
      [expiredHash]
    );
    const expiredSessionRegistrations = await client.query('SELECT email FROM registrations');
    assert.equal(expiredSessionRegistrations.rowCount, 0);
    return true;
  });

  assert.equal(result, true);
});

test('não efetiva uma inscrição fora do evento ativo', {
  skip: enabled ? false : 'Configure TEST_DATABASE_URL e TEST_DATABASE_MIGRATION_URL para executar testes PostgreSQL.'
}, async () => {
  const allowedEvent = await createEvent();
  const otherEvent = await createEvent();
  const email = `${crypto.randomUUID()}@test.invalid`;

  await assert.rejects(
    withRuntimeTransaction(allowedEvent, '', client => client.query(
      `INSERT INTO registrations
         (id, event_key, full_name, email, phone, consent_at, consent_version)
       VALUES ($1, $2, 'Pessoa de teste', $3, '21999999999', NOW(), 'test')`,
      [crypto.randomUUID(), otherEvent, email]
    ))
  );

  const { rows } = await migrationPool.query('SELECT COUNT(*)::int AS count FROM registrations WHERE email = $1', [email]);
  assert.equal(rows[0].count, 0);
});

test('a capacidade é aplicada atomicamente quando duas inscrições chegam juntas', {
  skip: enabled ? false : 'Configure TEST_DATABASE_URL e TEST_DATABASE_MIGRATION_URL para executar testes PostgreSQL.'
}, async () => {
  const eventKey = await createEvent({ capacity: 1 });
  const attempts = await Promise.allSettled([
    insertAsRuntime(eventKey, `${crypto.randomUUID()}@test.invalid`),
    insertAsRuntime(eventKey, `${crypto.randomUUID()}@test.invalid`)
  ]);

  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = attempts.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'P0001');
  assert.equal(rejected.reason.message, 'EVENT_FULL');

  const { rows } = await migrationPool.query(
    `SELECT c.registered_count, COUNT(r.id)::int AS registrations_count
     FROM event_capacity c
     LEFT JOIN registrations r ON r.event_key = c.event_key
     WHERE c.event_key = $1
     GROUP BY c.registered_count`,
    [eventKey]
  );
  assert.deepEqual(rows[0], { registered_count: 1, registrations_count: 1 });
});
