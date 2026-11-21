import { createServer } from 'node:http';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { db, domains, questions } from './db.mjs';

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.PORT || 3000);
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5180';
const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is unset; sessions will expire when this process restarts.');
const LIMIT = 1024 * 1024;
const authAttempts = new Map();
const now = () => new Date().toISOString();
const sha = value => createHmac('sha256', sessionSecret).update(value).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

function cookie(req, name) {
  const raw = req.headers.cookie || '';
  const part = raw.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `fahan_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `fahan_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(data));
}
function fail(res, status, error, code) { send(res, status, { error, code }); }
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
}
function authGuard(req, res, user) {
  if (!user) { fail(res, 401, 'Sign in to continue.', 'AUTH_REQUIRED'); return false; }
  return true;
}
function isAdmin(req, res, user) {
  if (!authGuard(req, res, user)) return false;
  if (user.role !== 'admin') { fail(res, 403, 'Administrator access is required.', 'ADMIN_REQUIRED'); return false; }
  return true;
}
function hasPremium(user) {
  if (user?.role === 'admin') return true;
  return !!user && db.prepare(`SELECT 1 FROM subscriptions WHERE user_id=? AND status IN ('active','trialing')`).get(user.id);
}
function lessonRow(row) {
  if (!row) return null;
  return { id: row.id, domainId: row.domain_id, title: row.title, minutes: row.minutes, body: JSON.parse(row.body_json), exercise: row.exercise, updatedAt: row.updated_at };
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role }; }
function sessionUser(req) {
  const token = cookie(req, 'fahan_session');
  if (!token) return null;
  const record = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(sha(token), Date.now());
  return record || null;
}
function setNewSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(token), userId, Date.now() + 7 * 86400000);
  setSessionCookie(res, token);
}
function mutationOriginOk(req, res) {
  const origin = req.headers.origin;
  if (origin && origin !== APP_ORIGIN) { fail(res, 403, 'Request origin is not allowed.', 'ORIGIN_REJECTED'); return false; }
  return true;
}
function throttle(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  const time = Date.now(); const entry = authAttempts.get(ip) || { start: time, count: 0 };
  if (time - entry.start > 15 * 60 * 1000) { entry.start = time; entry.count = 0; }
  entry.count += 1; authAttempts.set(ip, entry);
  if (entry.count > 30) { fail(res, 429, 'Too many sign-in attempts. Try again later.', 'RATE_LIMITED'); return false; }
  return true;
}
function publicCatalog(user) {
  const done = user ? new Set(db.prepare('SELECT lesson_id FROM progress WHERE user_id=?').all(user.id).map(x => x.lesson_id)) : new Set();
  const premium = hasPremium(user);
  return domains.map(domain => {
    const items = db.prepare('SELECT id,title,minutes,domain_id FROM content WHERE domain_id=? ORDER BY id').all(domain.id);
    return {
      ...domain,
      lessons: items.map((item, index) => ({
        ...item, domainId: item.domain_id, preview: item.id === 'd1-l1', locked: !(item.id === 'd1-l1' || premium),
        completed: done.has(item.id), hasQuiz: questions.some(q => q.domainId === domain.id)
      }))
    };
  });
}
function stripeReady() {
  return !!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') &&
    !!process.env.STRIPE_WEBHOOK_SECRET && !!process.env.STRIPE_PRICE_ID?.startsWith('price_');
}
function billingStatus(user) {
  const sub = user ? db.prepare('SELECT status FROM subscriptions WHERE user_id=?').get(user.id) : null;
  const configured = stripeReady();
  return {
    configured, mode: configured ? 'test' : null,
    state: user?.role === 'admin' ? 'admin' : (hasPremium(user) ? 'active' : (sub?.status || 'inactive')),
    message: configured ? 'Test-mode checkout is configured. A subscription becomes active only after a verified provider event.' : 'Subscriptions are not configured. Free preview lessons remain available.',
    portalAvailable: !!(configured && user && db.prepare('SELECT customer_id FROM subscriptions WHERE user_id=?').get(user.id)?.customer_id)
  };
}
async function stripePost(path, params) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Payment provider request failed.');
  return data;
}
function verifyStripe(raw, signature) {
  const parts = Object.fromEntries(String(signature || '').split(',').map(p => p.split('=')));
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  return safeEqual(createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${parts.t}.${raw}`).digest('hex'), parts.v1);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const user = sessionUser(req);
  if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, service: 'fahan-academy-api' });
  if (req.method === 'GET' && path === '/api/session') return send(res, 200, { user: user ? publicUser(user) : null });
  if (req.method === 'GET' && path === '/api/catalog') return send(res, 200, { domains: publicCatalog(user) });
  if (req.method === 'GET' && path === '/api/progress') {
    if (!authGuard(req, res, user)) return;
    const lessonsDone = db.prepare('SELECT lesson_id,completed_at FROM progress WHERE user_id=?').all(user.id);
    const attempts = db.prepare('SELECT domain_id,score,total,created_at FROM attempts WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(user.id);
    return send(res, 200, { lessons: lessonsDone, attempts });
  }
  if (req.method === 'GET' && path === '/api/billing') return send(res, 200, billingStatus(user));
  if (req.method === 'GET' && path.startsWith('/api/lessons/')) {
    const id = decodeURIComponent(path.slice('/api/lessons/'.length));
    const row = db.prepare('SELECT * FROM content WHERE id=?').get(id);
    if (!row) return fail(res, 404, 'Lesson not found.', 'NOT_FOUND');
    const canRead = id === 'd1-l1' || hasPremium(user);
    if (!canRead) return fail(res, 402, 'This lesson is part of the full course. Subscription checkout is currently unavailable.', 'PREMIUM_REQUIRED');
    return send(res, 200, { lesson: lessonRow(row) });
  }
  if (req.method === 'GET' && path.startsWith('/api/quiz/')) {
    const domainId = Number(path.slice('/api/quiz/'.length));
    if (!domains.some(d => d.id === domainId)) return fail(res, 404, 'Domain not found.', 'NOT_FOUND');
    if (!(domainId === 1 || hasPremium(user))) return fail(res, 402, 'This quiz is part of the full course. Subscription checkout is currently unavailable.', 'PREMIUM_REQUIRED');
    const items = questions.filter(q => q.domainId === domainId);
    return send(res, 200, { domainId, questions: items.map(({ answer, explanation, ...q }) => q) });
  }
  if (req.method === 'GET' && path === '/api/attempts') {
    if (!authGuard(req, res, user)) return;
    const items = db.prepare('SELECT id,domain_id,score,total,detail_json,created_at FROM attempts WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(user.id);
    return send(res, 200, { attempts: items.map(x => ({ id:x.id, domainId:x.domain_id, score:x.score, total:x.total, detail:JSON.parse(x.detail_json), createdAt:x.created_at })) });
  }
  if (req.method === 'GET' && path === '/api/admin/lessons') {
    if (!isAdmin(req, res, user)) return;
    return send(res, 200, { lessons: db.prepare('SELECT * FROM content ORDER BY domain_id,id').all().map(lessonRow) });
  }
  if (req.method === 'POST' && path === '/api/auth/register') {
    if (!mutationOriginOk(req, res) || !throttle(req, res)) return;
    const input = await body(req);
    const name = String(input.name || '').trim(); const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || '');
    if (name.length < 2 || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 200) {
      return fail(res, 400, 'Enter a name, valid email, and a password of at least 10 characters.', 'INVALID_INPUT');
    }
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return fail(res, 409, 'An account with that email already exists.', 'EMAIL_EXISTS');
    const id = randomUUID(); const salt = randomBytes(16).toString('hex'); const hash = (await scrypt(password, salt, 64)).toString('hex');
    db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').run(id,email,name,`${salt}:${hash}`,now());
    setNewSession(res,id);
    return send(res, 201, { user: publicUser({ id,email,name,role:'learner' }) });
  }
  if (req.method === 'POST' && path === '/api/auth/login') {
    if (!mutationOriginOk(req, res) || !throttle(req, res)) return;
    const input = await body(req); const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || '');
    const record = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    let valid = false;
    if (record?.password_hash) {
      const [salt, expected] = record.password_hash.split(':'); const actual = (await scrypt(password, salt, 64)).toString('hex');
      valid = safeEqual(actual, expected);
    } else {
      await scrypt(password || 'invalid-password', 'fahan-academy-salt', 64);
    }
    if (!valid) return fail(res, 401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(record.id);
    setNewSession(res,record.id);
    return send(res, 200, { user: publicUser(record) });
  }
  if (req.method === 'POST' && path === '/api/auth/logout') {
    if (!mutationOriginOk(req, res)) return;
    const token = cookie(req, 'fahan_session');
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
    clearSessionCookie(res);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && path === '/api/progress') {
    if (!mutationOriginOk(req, res) || !authGuard(req, res, user)) return;
    const input = await body(req); const lessonId = String(input.lessonId || '');
    const lesson = db.prepare('SELECT id FROM content WHERE id=?').get(lessonId);
    if (!lesson) return fail(res, 404, 'Lesson not found.', 'NOT_FOUND');
    if (!(lessonId === 'd1-l1' || hasPremium(user))) return fail(res, 402, 'Full-course access is required.', 'PREMIUM_REQUIRED');
    db.prepare('INSERT INTO progress(user_id,lesson_id,completed_at) VALUES(?,?,?) ON CONFLICT(user_id,lesson_id) DO UPDATE SET completed_at=excluded.completed_at').run(user.id,lessonId,now());
    return send(res, 200, { completed: true });
  }
  if (req.method === 'POST' && path === '/api/quiz/submit') {
    if (!mutationOriginOk(req, res) || !authGuard(req, res, user)) return;
    const input = await body(req); const domainId = Number(input.domainId); const answers = input.answers;
    if (!domains.some(d => d.id === domainId) || !Array.isArray(answers) || answers.length !== questions.filter(q => q.domainId === domainId).length) return fail(res, 400, 'Quiz submission is incomplete or invalid.', 'INVALID_QUIZ');
    if (!(domainId === 1 || hasPremium(user))) return fail(res, 402, 'Full-course access is required.', 'PREMIUM_REQUIRED');
    const qs = questions.filter(q => q.domainId === domainId);
    if (answers.some(a => !a || typeof a.questionId !== 'string' || !Number.isInteger(a.choice))) return fail(res, 400, 'Quiz answers are invalid.', 'INVALID_QUIZ');
    const submitted = new Map(answers.map(a => [a.questionId,a.choice]));
    if (submitted.size !== qs.length || qs.some(q => !submitted.has(q.id) || submitted.get(q.id) < 0 || submitted.get(q.id) >= q.options.length)) return fail(res, 400, 'Quiz answers are invalid.', 'INVALID_QUIZ');
    let score = 0;
    const detail = qs.map(q => {
      const selected = submitted.get(q.id); const correct = selected === q.answer; if (correct) score++;
      return { questionId:q.id, selected, answer:q.answer, correct, explanation:q.explanation };
    });
    const id = randomUUID();
    db.prepare('INSERT INTO attempts(id,user_id,domain_id,score,total,detail_json,created_at) VALUES(?,?,?,?,?,?,?)').run(id,user.id,domainId,score,qs.length,JSON.stringify(detail),now());
    return send(res, 200, { attemptId:id, score, total:qs.length, percent:Math.round(score * 100 / qs.length), detail, note:'Practice feedback only; this percentage is not an official scaled score or a pass prediction.' });
  }
  if (req.method === 'POST' && path === '/api/tutor') {
    if (!mutationOriginOk(req, res) || !authGuard(req, res, user)) return;
    if (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_MODEL) return fail(res, 503, 'Tutor unavailable: configure an Anthropic API key and a currently supported model on the server. Course content remains available.', 'TUTOR_UNCONFIGURED');
    if (!hasPremium(user)) return fail(res, 402, 'The AI tutor requires an active subscription.', 'PREMIUM_REQUIRED');
    const input = await body(req); const prompt = String(input.message || '').trim();
    if (prompt.length < 2 || prompt.length > 2000) return fail(res, 400, 'Enter a question of 2–2,000 characters.', 'INVALID_INPUT');
    const day = new Date().toISOString().slice(0,10);
    const used = db.prepare('SELECT count FROM tutor_usage WHERE user_id=? AND utc_day=?').get(user.id,day)?.count || 0;
    if (used >= 10) return fail(res, 429, 'Daily tutor limit reached (10 questions). Try again tomorrow.', 'TUTOR_LIMIT');
    db.prepare('INSERT INTO tutor_usage(user_id,utc_day,count) VALUES(?,?,1) ON CONFLICT(user_id,utc_day) DO UPDATE SET count=count+1').run(user.id,day);
    const source = db.prepare('SELECT domain_id,title,body_json FROM content ORDER BY domain_id,id').all()
      .map(x => `Domain ${x.domain_id}: ${x.title}\n${JSON.parse(x.body_json).join('\n')}`).join('\n\n').slice(0,24000);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{ 'x-api-key':process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
        body:JSON.stringify({ model:process.env.ANTHROPIC_MODEL, max_tokens:700, system:`You are Fahan Academy's study tutor. Ground answers in this course material; if it does not support a claim, say so. Do not claim to represent or be endorsed by any certification provider. Keep answers concise and encourage independent checking.\n\nCOURSE MATERIAL:\n${source}`, messages:[{role:'user',content:prompt}] }),
        signal:AbortSignal.timeout(20000)
      });
      if (!response.ok) return fail(res,502,'Tutor provider request failed. Please try again later.','TUTOR_UPSTREAM_ERROR');
      const data = await response.json();
      const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
      if (!text) return fail(res,502,'Tutor returned no usable text. Please try again later.','TUTOR_EMPTY');
      return send(res,200,{ answer:text, remaining:9-used });
    } catch { return fail(res,502,'Tutor could not be reached. Please try again later.','TUTOR_UPSTREAM_ERROR'); }
  }
  if (req.method === 'POST' && path === '/api/admin/bootstrap') {
    if (!mutationOriginOk(req, res) || !authGuard(req, res, user)) return;
    const input = await body(req);
    if (!process.env.ADMIN_BOOTSTRAP_KEY) return fail(res,503,'Admin bootstrap is disabled until ADMIN_BOOTSTRAP_KEY is configured.','BOOTSTRAP_UNCONFIGURED');
    if (!safeEqual(input.key,process.env.ADMIN_BOOTSTRAP_KEY)) return fail(res,403,'Bootstrap key is invalid.','INVALID_BOOTSTRAP_KEY');
    if (db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) return fail(res,409,'An administrator has already been bootstrapped.','BOOTSTRAP_USED');
    db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
    return send(res,200,{ user:publicUser({...user,role:'admin'}) });
  }
  const adminLesson = path.match(/^\/api\/admin\/lessons\/([a-z0-9-]+)$/);
  if (req.method === 'PUT' && adminLesson) {
    if (!mutationOriginOk(req, res) || !isAdmin(req, res, user)) return;
    const input = await body(req); const id=adminLesson[1];
    const existing=db.prepare('SELECT * FROM content WHERE id=?').get(id);
    if (!existing) return fail(res,404,'Lesson not found.','NOT_FOUND');
    const title=String(input.title || '').trim(); const exercise=String(input.exercise || '').trim();
    const paragraphs=input.body;
    if (title.length<3 || title.length>120 || exercise.length<10 || exercise.length>1500 || !Array.isArray(paragraphs) || paragraphs.length<2 || paragraphs.length>12 || paragraphs.some(p=>typeof p!=='string'||p.trim().length<30||p.length>3000)) return fail(res,400,'Lesson content is invalid. Include a title, two or more substantive paragraphs, and a practical exercise.','INVALID_CONTENT');
    db.prepare('UPDATE content SET title=?,body_json=?,exercise=?,updated_at=? WHERE id=?').run(title,JSON.stringify(paragraphs),exercise,now(),id);
    return send(res,200,{lesson:lessonRow(db.prepare('SELECT * FROM content WHERE id=?').get(id))});
  }
  if (req.method === 'POST' && path === '/api/billing/checkout') {
    if (!mutationOriginOk(req, res) || !authGuard(req, res, user)) return;
    if (!stripeReady()) return fail(res,503,'Test checkout unavailable: configure a Stripe test secret, test price, and verified webhook secret.','BILLING_UNCONFIGURED');
    if (hasPremium(user)) return fail(res,409,'An active subscription is already on this account.','ALREADY_SUBSCRIBED');
    try {
      const params=new URLSearchParams();
      params.set('mode','subscription'); params.set('line_items[0][price]',process.env.STRIPE_PRICE_ID); params.set('line_items[0][quantity]','1');
      params.set('client_reference_id',user.id); params.set('customer_email',user.email);
      params.set('subscription_data[metadata][userId]',user.id);
      params.set('success_url',`${APP_ORIGIN}/?billing=return`); params.set('cancel_url',`${APP_ORIGIN}/?billing=cancelled`);
      const session=await stripePost('checkout/sessions',params);
      if(!session.url) return fail(res,502,'Payment provider did not return a checkout URL.','BILLING_UPSTREAM_ERROR');
      return send(res,200,{url:session.url});
    } catch { return fail(res,502,'Test checkout could not be started. Please try again later.','BILLING_UPSTREAM_ERROR'); }
  }
  if (req.method === 'POST' && path === '/api/billing/portal') {
    if (!mutationOriginOk(req, res) || !authGuard(req, res, user)) return;
    if (!stripeReady()) return fail(res,503,'Customer portal unavailable until Stripe test mode is configured.','BILLING_UNCONFIGURED');
    const customer=db.prepare('SELECT customer_id FROM subscriptions WHERE user_id=?').get(user.id)?.customer_id;
    if(!customer) return fail(res,404,'No billing customer is linked to this account.','NO_BILLING_CUSTOMER');
    try {
      const params=new URLSearchParams({customer,return_url:APP_ORIGIN});
      const session=await stripePost('billing_portal/sessions',params);
      if(!session.url) return fail(res,502,'Payment provider did not return a customer portal URL.','BILLING_UPSTREAM_ERROR');
      return send(res,200,{url:session.url});
    } catch { return fail(res,502,'Customer portal could not be opened.','BILLING_UPSTREAM_ERROR'); }
  }
  if (req.method === 'POST' && path === '/api/billing/webhook') {
    const chunks=[]; let size=0;
    for await(const chunk of req){ size+=chunk.length; if(size>LIMIT) return fail(res,413,'Webhook body is too large.','BODY_TOO_LARGE'); chunks.push(chunk); }
    const raw=Buffer.concat(chunks).toString('utf8');
    if(!process.env.STRIPE_WEBHOOK_SECRET || !verifyStripe(raw,req.headers['stripe-signature'])) return fail(res,400,'Webhook signature is invalid.','INVALID_SIGNATURE');
    let event; try { event=JSON.parse(raw); } catch { return fail(res,400,'Webhook payload is invalid.','INVALID_WEBHOOK'); }
    if(!event.id || !event.type) return fail(res,400,'Webhook event is invalid.','INVALID_WEBHOOK');
    if(event.livemode!==false) return fail(res,400,'Only Stripe test-mode events are supported.','TEST_MODE_REQUIRED');
    if(db.prepare('SELECT 1 FROM stripe_events WHERE event_id=?').get(event.id)) return send(res,200,{received:true,duplicate:true});
    const object=event.data?.object || {};
    const subscriptionTypes=['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'];
    const handleSubscription=subscriptionTypes.includes(event.type);
    if(handleSubscription && (!process.env.STRIPE_PRICE_ID || !object.items?.data?.some(item=>item.price?.id===process.env.STRIPE_PRICE_ID))) {
      return send(res,200,{received:true,ignored:true,reason:'Subscription does not contain the configured course price.'});
    }
    let userId=object.metadata?.userId || object.client_reference_id || null;
    if(!userId && object.customer) userId=db.prepare('SELECT user_id FROM subscriptions WHERE customer_id=?').get(object.customer)?.user_id || null;
    const transaction=db.prepare('INSERT INTO stripe_events(event_id,received_at) VALUES(?,?)');
    db.exec('BEGIN IMMEDIATE');
    try {
      transaction.run(event.id,now());
      if(event.type==='checkout.session.completed' && object.mode==='subscription' && object.client_reference_id && object.customer) {
        db.prepare(`INSERT INTO subscriptions(user_id,customer_id,subscription_id,status,updated_at) VALUES(?,?,?,'inactive',?)
          ON CONFLICT(user_id) DO UPDATE SET customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,updated_at=excluded.updated_at`)
          .run(object.client_reference_id,object.customer,object.subscription || null,now());
      } else if(handleSubscription && userId && db.prepare('SELECT id FROM users WHERE id=?').get(userId)) {
        const status=event.type==='customer.subscription.deleted' ? 'canceled' : (['active','trialing'].includes(object.status) ? object.status : 'inactive');
        db.prepare(`INSERT INTO subscriptions(user_id,customer_id,subscription_id,status,updated_at) VALUES(?,?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,status=excluded.status,updated_at=excluded.updated_at`)
          .run(userId,object.customer || null,object.id || null,status,now());
      }
      db.exec('COMMIT');
    } catch { db.exec('ROLLBACK'); return fail(res,500,'Webhook processing failed.','WEBHOOK_PROCESSING_ERROR'); }
    return send(res,200,{received:true});
  }
  return fail(res,404,'Route not found.','NOT_FOUND');
}

const mime = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
const server = createServer(async (req,res) => {
  try {
    if (req.url?.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.url !== '/api/billing/webhook' && !mutationOriginOk(req,res)) return;
      return await handle(req,res);
    }
    if (process.env.NODE_ENV === 'production' || process.argv.includes('--serve-web')) {
      const dist=join(process.cwd(),'dist');
      const requested=normalize(decodeURIComponent(new URL(req.url,'http://localhost').pathname)).replace(/^(\.\.[/\\])+/, '');
      const file=join(dist,requested === '/' ? 'index.html' : requested);
      try {
        const data=await readFile(file); res.writeHead(200,{'Content-Type':mime[extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'}); return res.end(data);
      } catch {
        const data=await readFile(join(dist,'index.html')); res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'}); return res.end(data);
      }
    }
    res.writeHead(404,{'Content-Type':'text/plain'}); res.end('Frontend is served by Vite in development.');
  } catch (error) {
    if (!res.headersSent) send(res,error.status || 500,{error:error.status ? error.message : 'Unexpected server error.',code:'REQUEST_FAILED'});
    else res.destroy();
  }
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Fahan Academy API listening on http://localhost:${PORT}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{ server.close(()=>{ db.close(); process.exit(0); }); });
