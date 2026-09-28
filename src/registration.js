const DUPLICATE_EMAIL_CONSTRAINT = 'registrations_event_email_unique';

const response = Object.freeze({
  status: 202,
  body: Object.freeze({
    message: 'Solicitação recebida. Se já existir uma inscrição para este e-mail, o cadastro anterior foi mantido. Caso contrário, os dados foram registrados. Se precisar confirmar sua presença, fale com a organização do evento.'
  })
});

export async function processRegistration(writeRegistration) {
  try {
    await writeRegistration();
  } catch (error) {
    const isDuplicateEmail = error?.code === '23505'
      && error.constraint === DUPLICATE_EMAIL_CONSTRAINT;
    if (!isDuplicateEmail) throw error;
  }

  return response;
}
