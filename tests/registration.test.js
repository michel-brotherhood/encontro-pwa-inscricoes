import assert from 'node:assert/strict';
import test from 'node:test';
import { processRegistration } from '../src/registration.js';

test('new and duplicate registration requests return the same public response', async () => {
  const created = await processRegistration(async () => {});
  const duplicate = await processRegistration(async () => {
    const error = new Error('duplicate key');
    error.code = '23505';
    error.constraint = 'registrations_event_email_unique';
    throw error;
  });

  assert.deepEqual(duplicate, created);
  assert.equal(created.status, 200);
  assert.equal('id' in created.body, false);
  assert.match(created.body.message, /organização/);
});

test('does not disguise unrelated database errors as duplicate registrations', async () => {
  const error = new Error('database unavailable');
  await assert.rejects(processRegistration(async () => { throw error; }), error);
});

test('does not treat a different unique constraint as an existing email', async () => {
  const error = new Error('duplicate id');
  error.code = '23505';
  error.constraint = 'registrations_pkey';

  await assert.rejects(processRegistration(async () => { throw error; }), error);
});

test('does not disguise a full event as an existing email', async () => {
  const error = new Error('EVENT_FULL');
  error.code = 'P0001';

  await assert.rejects(processRegistration(async () => { throw error; }), error);
});
