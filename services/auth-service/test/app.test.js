const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');

const SECRET = 'test-secret-value';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// A database that fails loudly if a test reaches it unexpectedly
const noPool = {
  query: async () => {
    throw new Error('database should not be called in this test');
  },
};

async function withServer(pool, run) {
  const app = createApp({ pool, jwtSecret: SECRET });
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

function call(base, path, method, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const tokenFor = (id = 1) =>
  jwt.sign({ email: 'a@b.c' }, SECRET, { subject: String(id), expiresIn: '1h' });

test('createApp refuses to start without a JWT secret', () => {
  assert.throws(() => createApp({ pool: noPool, jwtSecret: '' }), /jwtSecret is required/);
});

test('register rejects missing fields and short passwords', async () => {
  await withServer(noPool, async (base) => {
    const missing = await call(base, '/register', 'POST', { email: 'a@b.c' });
    assert.equal(missing.status, 400);
    const short = await call(base, '/register', 'POST', { email: 'a@b.c', password: 'short' });
    assert.equal(short.status, 400);
  });
});

test('register lowercases the email and stores a bcrypt hash, never the password', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push(params);
      return { rows: [{ id: 1, email: params[0] }] };
    },
  };
  await withServer(pool, async (base) => {
    const res = await call(base, '/register', 'POST', {
      email: 'New@Example.com',
      password: 'password123',
    });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: 1, email: 'new@example.com' });

    const [email, storedHash] = calls[0];
    assert.equal(email, 'new@example.com');
    assert.notEqual(storedHash, 'password123');
    assert.ok(storedHash.startsWith('$2'), 'expected a bcrypt hash');
    assert.ok(await bcrypt.compare('password123', storedHash));
  });
});

test('register returns 409 for a duplicate email', async () => {
  const pool = {
    query: async () => {
      const err = new Error('duplicate key');
      err.code = '23505';
      throw err;
    },
  };
  await withServer(pool, async (base) => {
    const res = await call(base, '/register', 'POST', { email: 'a@b.c', password: 'password123' });
    assert.equal(res.status, 409);
  });
});

test('login returns a valid JWT for correct credentials', async () => {
  const hash = bcrypt.hashSync('password123', 4);
  const pool = { query: async () => ({ rows: [{ id: 1, email: 'a@b.c', password_hash: hash }] }) };
  await withServer(pool, async (base) => {
    const res = await call(base, '/login', 'POST', { email: 'a@b.c', password: 'password123' });
    assert.equal(res.status, 200);
    const { token } = await res.json();
    const payload = jwt.verify(token, SECRET);
    assert.equal(payload.sub, '1');
    assert.equal(payload.email, 'a@b.c');
  });
});

test('login gives the same 401 for an unknown email and a wrong password', async () => {
  const hash = bcrypt.hashSync('password123', 4);
  const knownUser = { query: async () => ({ rows: [{ id: 1, email: 'a@b.c', password_hash: hash }] }) };
  const unknownUser = { query: async () => ({ rows: [] }) };

  let wrongPassword;
  await withServer(knownUser, async (base) => {
    const res = await call(base, '/login', 'POST', { email: 'a@b.c', password: 'wrongpassword' });
    assert.equal(res.status, 401);
    wrongPassword = await res.json();
  });

  await withServer(unknownUser, async (base) => {
    const res = await call(base, '/login', 'POST', { email: 'nobody@b.c', password: 'password123' });
    assert.equal(res.status, 401);
    // Identical bodies mean attackers can't discover which emails exist
    assert.deepEqual(await res.json(), wrongPassword);
  });
});

test('creating an API key requires a login and stores only the hash', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push(params);
      return { rows: [] };
    },
  };
  await withServer(pool, async (base) => {
    const denied = await call(base, '/api-keys', 'POST', { name: 'x' });
    assert.equal(denied.status, 401);

    const res = await call(base, '/api-keys', 'POST', { name: 'ci' }, { Authorization: `Bearer ${tokenFor(7)}` });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.apiKey.startsWith('sk_'));
    assert.equal(body.keyPrefix, body.apiKey.slice(0, 11));

    assert.equal(calls.length, 1);
    const params = calls[0];
    assert.equal(params[0], 7);
    assert.equal(params[3], sha256(body.apiKey));
    assert.ok(!params.includes(body.apiKey), 'the plaintext key must never reach the database');
  });
});

test('revoking a key returns 204, or 404 when nothing matched', async () => {
  let rowCount = 1;
  const pool = { query: async () => ({ rowCount }) };
  await withServer(pool, async (base) => {
    const headers = { Authorization: `Bearer ${tokenFor()}` };
    const ok = await call(base, '/api-keys/1', 'DELETE', undefined, headers);
    assert.equal(ok.status, 204);

    rowCount = 0;
    const missing = await call(base, '/api-keys/99', 'DELETE', undefined, headers);
    assert.equal(missing.status, 404);
  });
});

test('verify rejects requests with no credentials', async () => {
  await withServer(noPool, async (base) => {
    const res = await call(base, '/verify', 'GET');
    assert.equal(res.status, 401);
  });
});

test('verify accepts a valid JWT', async () => {
  await withServer(noPool, async (base) => {
    const res = await call(base, '/verify', 'GET', undefined, { Authorization: `Bearer ${tokenFor(5)}` });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      valid: true,
      method: 'jwt',
      user: { id: 5, email: 'a@b.c' },
    });
  });
});

test('verify rejects expired tokens and tokens signed with another secret', async () => {
  await withServer(noPool, async (base) => {
    const expired = jwt.sign(
      { email: 'a@b.c', exp: Math.floor(Date.now() / 1000) - 60 },
      SECRET,
      { subject: '1' }
    );
    const forged = jwt.sign({ email: 'a@b.c' }, 'some-other-secret', { subject: '1', expiresIn: '1h' });

    for (const token of [expired, forged]) {
      const res = await call(base, '/verify', 'GET', undefined, { Authorization: `Bearer ${token}` });
      assert.equal(res.status, 401);
    }
  });
});

test('verify looks API keys up by hash, and rejects unknown keys', async () => {
  const lookups = [];
  const pool = {
    query: async (sql, params) => {
      lookups.push(params[0]);
      return { rows: params[0] === sha256('sk_valid') ? [{ id: 3, email: 'k@example.com' }] : [] };
    },
  };
  await withServer(pool, async (base) => {
    const ok = await call(base, '/verify', 'GET', undefined, { 'X-API-Key': 'sk_valid' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), {
      valid: true,
      method: 'api_key',
      user: { id: 3, email: 'k@example.com' },
    });

    const bad = await call(base, '/verify', 'GET', undefined, { 'X-API-Key': 'sk_unknown' });
    assert.equal(bad.status, 401);

    assert.ok(!lookups.includes('sk_valid'), 'the database must be queried with the hash, not the key');
  });
});