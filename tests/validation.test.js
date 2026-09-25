import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegistrationLimit, validateRegistration } from '../src/validation.js';

const valid = { name: '  Maria   da Silva ', email: ' MARIA@EXEMPLO.COM ', phone: '(21) 99999-9999', interest: 'Networking e conexões', consent: true };

test('normaliza os dados válidos antes de persistir', () => {
  const result = validateRegistration(valid);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { fullName: 'Maria da Silva', email: 'maria@exemplo.com', phone: '21999999999', interest: 'Networking e conexões' });
});

test('rejeita e-mail inválido e consentimento ausente', () => {
  assert.equal(validateRegistration({ ...valid, email: 'sem-email' }).field, 'email');
  assert.equal(validateRegistration({ ...valid, consent: false }).field, 'consent');
});

test('rejeita opções de interesse fora da lista permitida', () => {
  assert.equal(validateRegistration({ ...valid, interest: 'opção arbitrária' }).field, 'interest');
});

test('valida limite opcional de vagas', () => {
  assert.equal(parseRegistrationLimit(''), null);
  assert.equal(parseRegistrationLimit('120'), 120);
  assert.throws(() => parseRegistrationLimit('-2'));
  assert.throws(() => parseRegistrationLimit('abc'));
});
