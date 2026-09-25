const ALLOWED_INTERESTS = new Set([
  '',
  'Conteúdo e aprendizagem',
  'Networking e conexões',
  'Novas oportunidades',
  'Quero conhecer o evento'
]);

export function validateRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, field: 'form', message: 'Confira os dados enviados.' };
  }

  const fullName = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const phone = typeof input.phone === 'string' ? input.phone.replace(/\D/g, '') : '';
  const interest = typeof input.interest === 'string' ? input.interest : '';

  if (fullName.length < 3 || fullName.length > 100) {
    return { ok: false, field: 'name', message: 'Informe seu nome completo.' };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, field: 'email', message: 'Informe um e-mail válido.' };
  }
  if (phone.length < 10 || phone.length > 13) {
    return { ok: false, field: 'phone', message: 'Informe WhatsApp com DDD.' };
  }
  if (!ALLOWED_INTERESTS.has(interest)) {
    return { ok: false, field: 'interest', message: 'Selecione uma opção válida.' };
  }
  if (input.consent !== true) {
    return { ok: false, field: 'consent', message: 'É necessário autorizar o uso dos dados para esta inscrição.' };
  }

  return { ok: true, value: { fullName, email, phone, interest: interest || null } };
}

export function parseRegistrationLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('REGISTRATION_LIMIT precisa ser um inteiro positivo.');
  return limit;
}
