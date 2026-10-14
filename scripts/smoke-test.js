// End-to-end smoke test. Base URLs are configurable so the same script
// can later run against Kubernetes or Azure instead of localhost.
const URL_SERVICE = process.env.URL_SERVICE || 'http://localhost:3000';
const REDIRECT_SERVICE = process.env.REDIRECT_SERVICE || 'http://localhost:3001';
const AUTH_SERVICE = process.env.AUTH_SERVICE || 'http://localhost:3002';
const ANALYTICS_SERVICE = process.env.ANALYTICS_SERVICE || 'http://localhost:8000';

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

async function main() {
  console.log('Health checks');
  const services = {
    'url-service': URL_SERVICE,
    'redirect-service': REDIRECT_SERVICE,
    'auth-service': AUTH_SERVICE,
    'analytics-service': ANALYTICS_SERVICE,
  };
  for (const [name, base] of Object.entries(services)) {
    try {
      const r = await fetch(`${base}/health`);
      check(`${name} is healthy`, r.ok, `(status ${r.status})`);
    } catch (e) {
      check(`${name} is healthy`, false, `(${e.message})`);
    }
  }
  abortIfFailed();

  console.log('Auth');
  const email = `smoke-${Date.now()}@example.com`;
  const password = 'smoke-test-pass-123';

  let r = await fetch(`${AUTH_SERVICE}/register`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  check('register returns 201', r.status === 201, `(got ${r.status})`);

  r = await fetch(`${AUTH_SERVICE}/login`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  const { token } = await r.json();
  check('login returns a token', r.status === 200 && !!token, `(got ${r.status})`);

  r = await fetch(`${AUTH_SERVICE}/api-keys`, {
    method: 'POST',
    headers: { ...jsonHeaders, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'smoke test' }),
  });
  const { apiKey } = await r.json();
  check('api key is created', r.status === 201 && !!apiKey, `(got ${r.status})`);
  abortIfFailed();

  console.log('URL creation');
  r = await fetch(`${URL_SERVICE}/urls`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ url: 'https://example.com/smoke' }),
  });
  check('create without credentials is rejected (401)', r.status === 401, `(got ${r.status})`);

  r = await fetch(`${URL_SERVICE}/urls`, {
    method: 'POST',
    headers: { ...jsonHeaders, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: 'https://example.com/smoke' }),
  });
  const created = await r.json();
  check('create with JWT returns 201', r.status === 201 && !!created.shortCode, `(got ${r.status})`);

  r = await fetch(`${URL_SERVICE}/urls`, {
    method: 'POST',
    headers: { ...jsonHeaders, 'X-API-Key': apiKey },
    body: JSON.stringify({ url: 'https://example.com/smoke-key' }),
  });
  check('create with API key returns 201', r.status === 201, `(got ${r.status})`);

  r = await fetch(`${URL_SERVICE}/urls`, {
    method: 'POST',
    headers: { ...jsonHeaders, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: 'not-a-url' }),
  });
  check('invalid url is rejected (400)', r.status === 400, `(got ${r.status})`);
  abortIfFailed();

  console.log('Redirect');
  r = await fetch(`${REDIRECT_SERVICE}/${created.shortCode}`, { redirect: 'manual' });
  check('redirect returns 302', r.status === 302, `(got ${r.status})`);
  check(
    'redirect points to the original url',
    r.headers.get('location') === 'https://example.com/smoke',
    `(got ${r.headers.get('location')})`
  );

  r = await fetch(`${REDIRECT_SERVICE}/doesnotexist`, { redirect: 'manual' });
  check('unknown code returns 404', r.status === 404, `(got ${r.status})`);

  console.log('Analytics (async pipeline)');
  let total = 0;
  for (let i = 0; i < 10 && total < 1; i++) {
    r = await fetch(`${ANALYTICS_SERVICE}/stats/${created.shortCode}`);
    if (r.ok) total = (await r.json()).totalClicks;
    if (total < 1) await sleep(1000);
  }
  check('click event reached analytics', total >= 1, `(totalClicks=${total})`);

  console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke test crashed:', e);
  process.exit(1);
});