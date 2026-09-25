const form = document.querySelector('#registration-form');
const message = document.querySelector('#form-message');
const dialog = document.querySelector('#success-dialog');
const submitButton = form.querySelector('[type="submit"]');
const retryEventButton = document.querySelector('#retry-event');
let latestRegistration = null;
let eventDetails = null;
const formatEventTime = (time) => time.endsWith(':00') ? `${time.slice(0, 2)}h` : `${time}h`;
const formatEventDate = (date) => {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
};

async function loadEventDetails() {
  submitButton.disabled = true;
  retryEventButton.hidden = true;
  retryEventButton.disabled = true;
  message.textContent = 'Carregando informações do evento…';

  try {
    const response = await fetch('/api/event');
    if (!response.ok) throw new Error('Evento indisponível');
    const details = await response.json();
    if (
      typeof details?.monthLabel !== 'string' || !details.monthLabel.trim() ||
      typeof details?.startTime !== 'string' || !/^\d{2}:\d{2}$/.test(details.startTime) ||
      typeof details?.venueName !== 'string' || !details.venueName.trim() ||
      (details.eventDate !== null && (typeof details.eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(details.eventDate)))
    ) throw new Error('Configuração do evento inválida');

    eventDetails = details;
    document.querySelector('#event-month').textContent = eventDetails.monthLabel;
    document.querySelector('#event-time').textContent = formatEventTime(eventDetails.startTime.slice(0, 5));
    document.querySelector('#event-venue').textContent = eventDetails.venueName;
    document.querySelector('#event-date-note').textContent = eventDetails.eventDate
      ? `Data: ${formatEventDate(eventDetails.eventDate)}`
      : 'Dia exato a confirmar';

    const eventSummary = `${eventDetails.monthLabel} · ${formatEventTime(eventDetails.startTime.slice(0, 5))} · ${eventDetails.venueName}`;
    document.querySelector('#event-summary-footer').textContent = eventSummary;
    document.querySelector('#event-summary-schedule').textContent = eventSummary;
    document.querySelector('#event-summary-signup').textContent = `Inscrição individual. ${eventSummary}. ${eventDetails.eventDate ? `Data confirmada: ${formatEventDate(eventDetails.eventDate)}.` : 'Dia exato a confirmar.'}`;
    message.textContent = '';
    submitButton.disabled = false;
  } catch {
    eventDetails = null;
    document.querySelector('#event-month').textContent = 'Evento indisponível';
    document.querySelector('#event-time').textContent = '—';
    document.querySelector('#event-venue').textContent = 'Local a confirmar';
    document.querySelector('#event-date-note').textContent = 'Data a confirmar';
    document.querySelector('#event-summary-footer').textContent = 'Informações do evento indisponíveis no momento';
    document.querySelector('#event-summary-schedule').textContent = 'Informações do evento indisponíveis no momento';
    document.querySelector('#event-summary-signup').textContent = 'Não foi possível carregar as informações do evento.';
    message.textContent = 'Não foi possível carregar as informações do evento. Confira sua conexão e tente novamente.';
    retryEventButton.hidden = false;
  } finally {
    retryEventButton.disabled = false;
  }
}
retryEventButton.addEventListener('click', loadEventDetails);
loadEventDetails();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  if (!eventDetails) {
    message.textContent = 'As informações do evento ainda não estão disponíveis. Tente carregá-las novamente.';
    retryEventButton.hidden = false;
    return;
  }
  if (!form.reportValidity()) return;

  const data = new FormData(form);
  const payload = {
    name: String(data.get('name')).trim(),
    email: String(data.get('email')).trim(),
    phone: String(data.get('phone')).trim(),
    interest: String(data.get('interest') || ''),
    consent: data.get('consent') === 'on'
  };
  submitButton.disabled = true;
  submitButton.setAttribute('aria-busy', 'true');
  submitButton.querySelector('span').textContent = '…';

  try {
    const response = await fetch('/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      message.textContent = result.error || 'Não foi possível concluir a inscrição.';
      if (result.field && form.elements.namedItem(result.field)) form.elements.namedItem(result.field).focus();
      return;
    }
    latestRegistration = { ...payload, ...result };
    document.querySelector('#success-summary').textContent = `Obrigado, ${payload.name.split(' ')[0]}. Sua inscrição foi registrada no sistema.`;
    const ticket = document.querySelector('#ticket');
    ticket.replaceChildren();
    const code = document.createElement('strong');
    code.textContent = result.id;
    const details = document.createElement('span');
    details.textContent = `${eventDetails.monthLabel} · ${formatEventTime(eventDetails.startTime.slice(0, 5))} · ${eventDetails.venueName}${eventDetails.eventDate ? ` · ${eventDetails.eventDate}` : ' · dia exato a confirmar'}`;
    const attendee = document.createElement('span');
    attendee.textContent = payload.name;
    ticket.append(code, document.createElement('br'), details, document.createElement('br'), attendee);
    dialog.showModal();
    form.reset();
  } catch {
    message.textContent = 'Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.';
  } finally {
    submitButton.disabled = !eventDetails;
    submitButton.removeAttribute('aria-busy');
    submitButton.querySelector('span').textContent = '↗';
  }
});

function closeDialog() { dialog.close(); }
document.querySelector('.dialog-close').addEventListener('click', closeDialog);
document.querySelector('#close-dialog').addEventListener('click', closeDialog);
document.querySelector('#download-ticket').addEventListener('click', () => {
  if (!latestRegistration) return;
  const eventDate = eventDetails.eventDate ? `Data: ${eventDetails.eventDate}` : `Dia exato: a confirmar pela organização`;
  const content = `COMPROVANTE DE INSCRIÇÃO\n\nEncontro — Ideias que movem o amanhã\n${eventDetails.monthLabel}, às ${formatEventTime(eventDetails.startTime.slice(0, 5))}\nLocal: ${eventDetails.venueName}\n${eventDate}\n\nParticipante: ${latestRegistration.name}\nCódigo: ${latestRegistration.id}\nE-mail: ${latestRegistration.email}\n\nGuarde este comprovante.`;
  const objectUrl = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `inscricao-${latestRegistration.id}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
});

const menuToggle = document.querySelector('#menu-toggle');
const mainNav = document.querySelector('#main-nav');
menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Abrir menu' : 'Fechar menu');
  mainNav.classList.toggle('is-open', !isOpen);
});
mainNav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Abrir menu');
  mainNav.classList.remove('is-open');
}));
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Abrir menu');
    mainNav.classList.remove('is-open');
    menuToggle.focus();
  }
});

let installPrompt = null;
const installButton = document.querySelector('#install-app');
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.hidden = true;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installButton.hidden = true;
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
