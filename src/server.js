import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import { validateRegistration } from './validation.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(currentDir, '../public');
const app = express();
const port = Number(process.env.PORT || 3000);
const eventKey = process.env.EVENT_KEY || 'encontro-janeiro-2027';
const consentVersion = process.env.CONSENT_VERSION || 'v1';
const sessionHours = Number(process.env.SESSION_TTL_HOURS || 8);
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookieName = isProduction ? '__Host-admin_session' : 'admin_session';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.');
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_SALT || !process.env.ADMIN_PASSWORD_HASH) {
  throw new Error('Configure ADMIN_EMAIL, ADMIN_PASSWORD_SALT e ADMIN_PASSWORD_HASH antes de iniciar.');
}
if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 24) throw new Error('SESSION_TTL_HOURS deve estar entre 1 e 24.');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"],
      formAction: ["'self'"], frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '16kb', strict: true }));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const registrationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(left || ''); const b = Buffer.from(right || '');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
};
const cookieOptions = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionHours * 60 * 60}${isProduction ? '; Secure' : ''}`;

async function withDbContext(sessionHash, operation) {
  const client = await pool.connect();
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
  } finally { client.release(); }
}
function readCookie(req, name) {
  const pair = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return null; }
}
function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return res.status(403).json({ error: 'Origem da requisição não validada.' });
  try {
    if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origem da requisição não validada.' });
  } catch { return res.status(403).json({ error: 'Origem da requisição não validada.' }); }
  next();
}
async function requireAdmin(req, res, next) {
  const token = readCookie(req, sessionCookieName);
  if (!token || token.length > 200) return res.status(401).json({ error: 'Faça login para continuar.' });
  try {
    req.sessionHash = hashToken(token);
    const session = await withDbContext(req.sessionHash, client => client.query(
      'SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW()', [req.sessionHash]
    ));
    if (!session.rowCount) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    next();
  } catch (error) { next(error); }
}

app.get('/api/health', async (_req, res, next) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }
  catch (error) { next(error); }
});
app.get('/api/event', async (_req, res, next) => {
  try {
    const result = await withDbContext('', client => client.query(
      `SELECT title, to_char(event_month, 'YYYY-MM-DD') AS "eventMonth",
              to_char(event_date, 'YYYY-MM-DD') AS "eventDate",
              to_char(start_time, 'HH24:MI') AS "startTime", venue_name AS "venueName"
       FROM events WHERE event_key = $1`,
      [eventKey]
    ));
    if (!result.rowCount) return res.status(404).json({ error: 'Evento não encontrado.' });
    const event = result.rows[0];
    const monthLabel = new Date(`${event.eventMonth}T00:00:00Z`).toLocaleDateString('pt-BR', {
      month: 'long', year: 'numeric', timeZone: 'UTC'
    });
    res.json({
      title: event.title,
      eventMonth: event.eventMonth,
      monthLabel: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
      eventDate: event.eventDate,
      startTime: event.startTime,
      venueName: event.venueName
    });
  } catch (error) { next(error); }
});

app.post('/api/registrations', registrationLimiter, async (req, res, next) => {
  const validation = validateRegistration(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.message, field: validation.field });
  const id = crypto.randomUUID();
  const { fullName, email, phone, interest } = validation.value;
  try {
    await withDbContext('', client => client.query(
      `INSERT INTO registrations (id, event_key, full_name, email, phone, interest, consent_at, consent_version)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
      [id, eventKey, fullName, email, phone, interest, consentVersion]
    ));
    return res.status(201).json({ id });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Este e-mail já está inscrito neste evento.' });
    if (error.code === 'P0001' && error.message === 'EVENT_FULL') return res.status(409).json({ error: 'As vagas deste evento foram preenchidas.' });
    next(error);
  }
});

app.post('/api/admin/login', loginLimiter, requireSameOrigin, async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password.length < 14 || password.length > 256 || email.length > 254) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  let suppliedHash = '';
  try { suppliedHash = crypto.scryptSync(password, process.env.ADMIN_PASSWORD_SALT, 64).toString('hex'); }
  catch { return res.status(401).json({ error: 'E-mail ou senha incorretos.' }); }
  if (email !== process.env.ADMIN_EMAIL.trim().toLowerCase() || !safeEqual(suppliedHash, process.env.ADMIN_PASSWORD_HASH.trim())) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000);
  try {
    const sessionHash = hashToken(token);
    await withDbContext(sessionHash, async client => {
      await client.query('INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)', [sessionHash, expiresAt]);
    });
    res.setHeader('Set-Cookie', `${sessionCookieName}=${encodeURIComponent(token)}; ${cookieOptions}`);
    res.json({ email, expiresAt });
  } catch (error) { next(error); }
});

app.get('/api/admin/session', requireAdmin, (_req, res) => res.json({ authenticated: true }));
app.post('/api/admin/logout', requireSameOrigin, requireAdmin, async (req, res, next) => {
  try {
    await withDbContext(req.sessionHash, client => client.query('DELETE FROM admin_sessions WHERE token_hash = $1', [req.sessionHash]));
    res.setHeader('Set-Cookie', `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isProduction ? '; Secure' : ''}`);
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get('/api/admin/registrations', requireAdmin, async (req, res, next) => {
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  try {
    const result = await withDbContext(req.sessionHash, async client => {
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM registrations
         WHERE event_key = $1 AND ($2 = '' OR full_name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')`,
        [eventKey, search]
      );
      const rows = await client.query(
        `SELECT id, full_name AS name, email, phone, interest, created_at AS "createdAt", checked_in_at AS "checkedInAt"
         FROM registrations
         WHERE event_key = $1 AND ($2 = '' OR full_name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
         ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [eventKey, search, limit, offset]
      );
      return { items: rows.rows, total: countResult.rows[0].total };
    });
    res.json({ ...result, limit, offset });
  } catch (error) { next(error); }
});
app.patch('/api/admin/registrations/:id/check-in', requireSameOrigin, requireAdmin, async (req, res, next) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ error: 'Identificador inválido.' });
  }
  if (typeof req.body?.checkedIn !== 'boolean') return res.status(400).json({ error: 'Envie checkedIn como boolean.' });
  try {
    const result = await withDbContext(req.sessionHash, client => client.query(
      `UPDATE registrations
       SET checked_in_at = CASE WHEN $1 THEN NOW() ELSE NULL END
       WHERE id = $2 AND event_key = $3
       RETURNING id, checked_in_at AS "checkedInAt"`,
      [req.body.checkedIn, req.params.id, eventKey]
    ));
    if (!result.rowCount) return res.status(404).json({ error: 'Inscrição não encontrada.' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.get('/admin', (_req, res) => res.redirect(302, '/admin.html'));
app.use(express.static(publicDir, { etag: true, maxAge: 0, setHeaders(res, filePath) {
  if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('admin.html') || filePath.endsWith('manifest.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
} }));
app.use((error, _req, res, _next) => {
  console.error('Erro na requisição:', error.message);
  if (res.headersSent) return;
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

const start = async () => {
  await pool.query('SELECT 1');
  app.listen(port, () => console.log(`Encontro PWA iniciado na porta ${port}.`));
};
start().catch(error => { console.error('Não foi possível iniciar a aplicação:', error.message); process.exit(1); });
