// Black-box smoke test: talks only to the public front door (the web service).
// Usage:  WEB=http://<host> node scripts/smoke-test-web.js
const WEB = (process.env.WEB || 'http://localhost:8080').replace(/\/+$/, '');
const WAIT_SECONDS = Number(process.env.WAIT_SECONDS || 60);

let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

function abortIfFailed() {
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed, stopping early`);
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jsonHeaders = { 'Content-Type': 'application/json' };

async function waitForHealthy(path = '/healthz') {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  let lastError = 'no response';
  while (true) {
    try {
      const r = await fetch(`${WEB}${path}`);
      if (r.ok) return { ok: true };
      lastError = `status ${r.status}`;
    } catch (e) {
      lastError = e.cause ? `${e.message}: ${e.cause.message}` : e.message;
    }
    if (Date.now() >= deadline) return { ok: false, detail: lastError };
    await sleep(2000);
  }
}

async function main() {
  console.log(`Smoke test against ${WEB}`);

  console.log('Front door');
  const health = await waitForHealthy();
  check('front door is healthy', health.ok, `(${health.detail})`);
  abortIfFailed();
  console.log('Backend');
  const backend = await waitForHealthy('/api/stats/probe');
  check('backend services are answering', backend.ok, `(${backend.detail})`);
  abortIfFailed();

  let r = await fetch(`${WEB}/`);
  const html = await r.text();
  check('UI page is served', r.status === 200 && html.includes('URL Shortener'), `(got ${r.status})`);

  console.log('Accounts');
  const email = `smoke-${Date.now()}@example.com`;
  const password = 'smoke-test-pass-123';

  r = await fetch(`${WEB}/api/auth/register`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  check('register returns 201', r.status === 201, `(got ${r.status})`);

  r = await fetch(`${WEB}/api/auth/login`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  const { token } = await r.json();
  check('login returns a token', r.status === 200 && !!token, `(got ${r.status})`);
  abortIfFailed();

  const auth = { ...jsonHeaders, Authorization: `Bearer ${token}` };

  console.log('Links');
  r = await fetch(`${WEB}/api/urls`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ url: 'https://example.com/smoke' }),
  });
  check('create without credentials is rejected (401)', r.status === 401, `(got ${r.status})`);

  r = await fetch(`${WEB}/api/urls`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://example.com/smoke' }),
  });
  const created = await r.json();
  check('create returns 201', r.status === 201 && !!created.shortCode, `(got ${r.status})`);
  abortIfFailed();

  r = await fetch(`${WEB}/api/urls`, { headers: auth });
  const list = await r.json();
  check(
    'list includes the new link',
    r.status === 200 && Array.isArray(list) && list.some((l) => l.shortCode === created.shortCode),
    `(got ${r.status})`
  );

  console.log('Redirect and analytics');
  r = await fetch(`${WEB}/${created.shortCode}`, { redirect: 'manual' });
  check('short link redirects (302)', r.status === 302, `(got ${r.status})`);
  check(
    'redirect points to the original URL',
    r.headers.get('location') === 'https://example.com/smoke',
    `(got ${r.headers.get('location')})`
  );

  r = await fetch(`${WEB}/doesnotexist`, { redirect: 'manual' });
  check('unknown code returns 404', r.status === 404, `(got ${r.status})`);

  let total = 0;
  for (let i = 0; i < 20 && total < 1; i++) {
    await fetch(`${WEB}/${created.shortCode}`, { redirect: 'manual' });
    await sleep(1000);
    r = await fetch(`${WEB}/api/stats/${created.shortCode}`);
    if (r.ok) total = (await r.json()).totalClicks;
  }
  check('click reached analytics', total >= 1, `(totalClicks=${total})`);

  console.log('Exposure');
  for (const path of ['/api/auth/verify', '/api/auth/api-keys' , '/metrics' ]) {
    r = await fetch(`${WEB}${path}`);
    check(`${path} is not exposed (404)`, r.status === 404, `(got ${r.status})`);
  }

  console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke test crashed:', e);
  process.exit(1);
});