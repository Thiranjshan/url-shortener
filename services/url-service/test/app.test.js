const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

// Fakes standing in for auth-service
const authOk = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ user: { id: 7, email: 'a@b.c' } }),
});
const authDenied = async () => ({ ok: false, status: 401, json: async () => ({}) });
const authDown = async () => {
  throw new Error('connection refused');
};

// A database that fails loudly if a test reaches it unexpectedly
const noPool = {
  query: async () => {
    throw new Error('database should not be called in this test');
  },
};

async function withServer({ pool, fetchFn }, run) {
  const app = createApp({
    pool,
    authServiceUrl: 'http://auth.test',
    baseUrl: 'http://short.test',
    fetchFn,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

function postUrl(base, body, headers = {}) {
  return fetch(`${base}/urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('POST /urls without credentials returns 401 and never calls auth-service', async () => {
  let authCalls = 0;
  const fetchFn = async () => {
    authCalls++;
    return authOk();
  };
  await withServer({ pool: noPool, fetchFn }, async (base) => {
    const res = await postUrl(base, { url: 'https://example.com' });
    assert.equal(res.status, 401);
    assert.equal(authCalls, 0);
  });
});

test('POST /urls with rejected credentials returns 401', async () => {
  await withServer({ pool: noPool, fetchFn: authDenied }, async (base) => {
    const res = await postUrl(base, { url: 'https://example.com' }, { Authorization: 'Bearer bad' });
    assert.equal(res.status, 401);
  });
});

test('POST /urls fails closed with 503 when auth-service is unreachable', async () => {
  await withServer({ pool: noPool, fetchFn: authDown }, async (base) => {
    const res = await postUrl(base, { url: 'https://example.com' }, { Authorization: 'Bearer any' });
    assert.equal(res.status, 503);
  });
});

test('POST /urls rejects missing, invalid and non-http URLs with 400', async () => {
  await withServer({ pool: noPool, fetchFn: authOk }, async (base) => {
    const headers = { Authorization: 'Bearer ok' };
    for (const url of ['not-a-url', 'ftp://example.com/file', 'javascript:alert(1)']) {
      const res = await postUrl(base, { url }, headers);
      assert.equal(res.status, 400, `expected 400 for ${url}`);
    }
    const missing = await postUrl(base, {}, headers);
    assert.equal(missing.status, 400);
  });
});

test('POST /urls stores the URL for the authenticated user and returns a short URL', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await withServer({ pool, fetchFn: authOk }, async (base) => {
    const res = await postUrl(base, { url: 'https://example.com/page' }, { 'X-API-Key': 'sk_test' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.originalUrl, 'https://example.com/page');
    assert.ok(body.shortUrl.startsWith('http://short.test/'));

    assert.equal(calls.length, 1);
    const [shortCode, originalUrl, userId] = calls[0].params;
    assert.equal(shortCode, body.shortCode);
    assert.equal(originalUrl, 'https://example.com/page');
    assert.equal(userId, 7);
  });
});

test('GET /urls/:code returns the original URL, or 404 when unknown', async () => {
  const pool = {
    query: async (sql, params) => ({
      rows: params[0] === 'abc1234' ? [{ original_url: 'https://example.com' }] : [],
    }),
  };
  await withServer({ pool, fetchFn: authOk }, async (base) => {
    const found = await fetch(`${base}/urls/abc1234`);
    assert.equal(found.status, 200);
    assert.deepEqual(await found.json(), { shortCode: 'abc1234', originalUrl: 'https://example.com' });

    const missing = await fetch(`${base}/urls/nope`);
    assert.equal(missing.status, 404);
  });
});