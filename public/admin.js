const loginView = document.querySelector('#login-view');
const dashboardView = document.querySelector('#dashboard-view');
const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const dashboardStatus = document.querySelector('#dashboard-status');
const rows = document.querySelector('#registration-rows');
const cards = document.querySelector('#registration-cards');
const searchInput = document.querySelector('#search-input');
let records = [];
let totalRecords = 0;
let pageOffset = 0;
const pageSize = 50;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || 'Ocorreu um erro na solicitação.');
    error.status = response.status;
    throw error;
  }
  return payload;
}
function showDashboard() { loginView.hidden = true; dashboardView.hidden = false; }
function showLogin() { dashboardView.hidden = true; loginView.hidden = false; }
function formatDate(date) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date)); }

async function loadRegistrations() {
  dashboardStatus.textContent = 'Carregando inscrições…';
  try {
    const query = new URLSearchParams({ limit: String(pageSize), offset: String(pageOffset), q: searchInput.value.trim() });
    const result = await api(`/api/admin/registrations?${query}`);
    records = result.items;
    totalRecords = result.total;
    renderRecords();
  } catch (error) {
    if (error.status === 401) { showLogin(); loginMessage.textContent = 'Sua sessão expirou. Entre novamente.'; }
    else dashboardStatus.textContent = error.message;
  }
}
function makeCheckinButton(record) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'checkin-button';
  button.setAttribute('aria-pressed', String(Boolean(record.checkedInAt)));
  button.textContent = record.checkedInAt ? 'Check-in feito' : 'Registrar check-in';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api(`/api/admin/registrations/${encodeURIComponent(record.id)}/check-in`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkedIn: !record.checkedInAt })
      });
      await loadRegistrations();
    } catch (error) { dashboardStatus.textContent = error.message; button.disabled = false; }
  });
  return button;
}
function renderRecords() {
  rows.replaceChildren();
  cards.replaceChildren();
  if (!records.length) {
    dashboardStatus.textContent = totalRecords ? 'Não há inscrições nesta página.' : 'Nenhuma inscrição encontrada.';
    updatePagination();
    return;
  }
  for (const record of records) {
    const tr = document.createElement('tr');
    const identity = document.createElement('td');
    const name = document.createElement('strong'); name.textContent = record.name;
    const interest = document.createElement('div'); interest.textContent = record.interest || 'Sem preferência informada';
    identity.append(name, document.createElement('br'), interest);
    const contact = document.createElement('td'); contact.textContent = `${record.email} · ${record.phone}`;
    const date = document.createElement('td'); date.textContent = formatDate(record.createdAt);
    const checkin = document.createElement('td'); checkin.append(makeCheckinButton(record));
    tr.append(identity, contact, date, checkin); rows.append(tr);

    const card = document.createElement('article'); card.className = 'registration-card';
    const cardName = document.createElement('h2'); cardName.textContent = record.name;
    const email = document.createElement('p'); email.textContent = record.email;
    const phone = document.createElement('p'); phone.textContent = record.phone;
    const cardDate = document.createElement('p'); cardDate.textContent = `Inscrito em ${formatDate(record.createdAt)}`;
    const cardInterest = document.createElement('p'); cardInterest.textContent = record.interest || 'Sem preferência informada';
    card.append(cardName, email, phone, cardDate, cardInterest, makeCheckinButton(record)); cards.append(card);
  }
  const first = pageOffset + 1;
  const last = Math.min(pageOffset + records.length, totalRecords);
  dashboardStatus.textContent = `${first}–${last} de ${totalRecords} inscrição(ões).`;
  updatePagination();
}
function updatePagination() {
  document.querySelector('#page-label').textContent = `Página ${Math.floor(pageOffset / pageSize) + 1}`;
  document.querySelector('#previous-page').disabled = pageOffset <= 0;
  document.querySelector('#next-page').disabled = pageOffset + pageSize >= totalRecords;
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = '';
  const data = new FormData(loginForm);
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(data.get('email')), password: String(data.get('password')) })
    });
    loginForm.reset(); showDashboard(); await loadRegistrations();
  } catch (error) { loginMessage.textContent = error.message; }
  finally { button.disabled = false; }
});
async function runSearch() { pageOffset = 0; await loadRegistrations(); }
document.querySelector('#search-button').addEventListener('click', runSearch);
searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });
document.querySelector('#previous-page').addEventListener('click', async () => { pageOffset = Math.max(0, pageOffset - pageSize); await loadRegistrations(); });
document.querySelector('#next-page').addEventListener('click', async () => { if (pageOffset + pageSize < totalRecords) { pageOffset += pageSize; await loadRegistrations(); } });
document.querySelector('#logout-button').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
  showLogin();
});
document.querySelector('#export-button').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  dashboardStatus.textContent = 'Preparando exportação…';
  try {
    const allRecords = [];
    for (let offset = 0; offset < totalRecords; offset += 500) {
      const query = new URLSearchParams({ limit: '500', offset: String(offset), q: searchInput.value.trim() });
      const result = await api(`/api/admin/registrations?${query}`);
      allRecords.push(...result.items);
    }
    const quote = value => {
      let text = String(value ?? '');
      if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
      return `\"${text.replaceAll('\"', '\"\"')}\"`;
    };
    const csv = ['Código,Nome,E-mail,WhatsApp,Interesse,Data,Check-in', ...allRecords.map(item => [item.id, item.name, item.email, item.phone, item.interest, item.createdAt, item.checkedInAt ? 'Sim' : 'Não'].map(quote).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'inscricoes-encontro.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dashboardStatus.textContent = `${allRecords.length} inscrição(ões) exportadas.`;
  } catch (error) { dashboardStatus.textContent = error.message; }
  finally { button.disabled = false; }
});

api('/api/admin/session').then(() => { showDashboard(); loadRegistrations(); }).catch(() => showLogin());
