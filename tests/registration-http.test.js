import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/server.js';

const testEnv = {
  DATABASE_URL: 'postgres://test.invalid/event',
  ADMIN_EMAIL: 'admin@example.test',
  ADMIN_PASSWORD_SALT: 'test-salt',
  ADMIN_PASSWORD_HASH: 'test-hash',
  EVENT_KEY: 'http-test-event'
};

function createDatabaseMock() {
  let insertBehavior = 'success';
  const inserts = [];
  const client = {
    async query(sql, values = []) {
      if (sql.startsWith('INSERT INTO registrations')) {
        inserts.push(values);
        if (insertBehavior === 'duplicate') {
          const error = new Error('duplicate key');
          error.code = '23505';
          error.constraint = 'registrations_event_email_unique';
          throw error;
        }
        if (insertBehavior === 'full') {
          const error = new Error('EVENT_FULL');
          error.code = 'P0001';
          throw error;
        }
        if (insertBehavior === 'failure') throw new Error('database password leaked');
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };

  return {
    pool: {
      async connect() { return client; },
      async query() { return { rowCount: 1, rows: [] }; }
    },
    inserts,
    setInsertBehavior(value) { insertBehavior = value; }
  };
}

async function startTestServer(t, dbPool) {
  const app = createApp({ dbPool, env: testEnv });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  return `http://127.0.0.1:${server.address().port}`;
}

const validRegistration = {
  name: 'Pessoa de Teste',
  email: 'pessoa@example.test',
  phone: '(21) 99999-9999',
  interest: 'Networking e conexões',
  consent: true
};

test('HTTP retorna a mesma resposta pública para inscrição nova e e-mail duplicado', async t => {
  const database = createDatabaseMock();
  const baseUrl = await startTestServer(t, database.pool);

  const createdResponse = await fetch(`${baseUrl}/api/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validRegistration)
  });
  const createdBody = await createdResponse.json();

  database.setInsertBehavior('duplicate');
  const duplicateResponse = await fetch(`${baseUrl}/api/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validRegistration)
  });
  const duplicateBody = await duplicateResponse.json();

  assert.equal(createdResponse.status, 200);
  assert.equal(createdResponse.headers.get('cache-control'), 'no-store');
  assert.equal(duplicateResponse.status, createdResponse.status);
  assert.deepEqual(duplicateBody, createdBody);
  assert.equal('id' in createdBody, false);
  assert.equal(JSON.stringify(createdBody).includes(validRegistration.email), false);
  assert.equal(database.inserts.length, 2);
  assert.notEqual(database.inserts[0][0], database.inserts[1][0]);
});

test('HTTP rejeita dados inválidos sem consultar o banco', async t => {
  const database = createDatabaseMock();
  const baseUrl = await startTestServer(t, database.pool);

  const response = await fetch(`${baseUrl}/api/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...validRegistration, consent: false })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'É necessário autorizar o uso dos dados para esta inscrição.',
    field: 'consent'
  });
  assert.equal(database.inserts.length, 0);
});

test('HTTP mantém o status 409 quando o evento está lotado', async t => {
  const database = createDatabaseMock();
  database.setInsertBehavior('full');
  const baseUrl = await startTestServer(t, database.pool);

  const response = await fetch(`${baseUrl}/api/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validRegistration)
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'As vagas deste evento foram preenchidas.' });
});

test('HTTP oculta detalhes de falhas inesperadas do banco', async t => {
  const database = createDatabaseMock();
  database.setInsertBehavior('failure');
  const baseUrl = await startTestServer(t, database.pool);

  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalConsoleError; });

  const response = await fetch(`${baseUrl}/api/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validRegistration)
  });

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, { error: 'Erro interno. Tente novamente.' });
  assert.equal(JSON.stringify(body).includes('password'), false);
});
