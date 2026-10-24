const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');

// Fakes standing in for url-service
const found = (originalUrl) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ originalUrl }),
});
const respondsWith = (code) => async () => ({ ok: code < 400, status: code, json: async () => ({}) });
const unreachable = async () => {
  throw new Error('connection refused');
};

function makeApp({ fetchFn, publishClick }) {
  return buildApp({ urlServiceUrl: 'http://url.test', fetchFn, publishClick });
}

test('redirects with 302 and publishes a click event', async () => {
  const events = [];
  const app = makeApp({
    fetchFn: found('https://example.com/target'),
    publishClick: (e) => events.push(e),
  });

  const res = await app.inject({
    method: 'GET',
    url: '/abc1234',
    headers: { 'user-agent': 'test-agent', referer: 'https://ref.example' },
  });

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, 'https://example.com/target');
  assert.equal(events.length, 1);
  assert.equal(events[0].shortCode, 'abc1234');
  assert.equal(events[0].userAgent, 'test-agent');
  assert.equal(events[0].referer, 'https://ref.example');
  assert.ok(!Number.isNaN(Date.parse(events[0].timestamp)));
});

test('unknown code returns 404 and publishes nothing', async () => {
  const events = [];
  const app = makeApp({ fetchFn: respondsWith(404), publishClick: (e) => events.push(e) });

  const res = await app.inject({ method: 'GET', url: '/nope' });

  assert.equal(res.statusCode, 404);
  assert.equal(events.length, 0);
});

test('upstream error returns 502 and publishes nothing', async () => {
  const events = [];
  const app = makeApp({ fetchFn: respondsWith(500), publishClick: (e) => events.push(e) });

  const res = await app.inject({ method: 'GET', url: '/abc1234' });

  assert.equal(res.statusCode, 502);
  assert.equal(events.length, 0);
});

test('url-service unreachable returns 502', async () => {
  const app = makeApp({ fetchFn: unreachable, publishClick: () => {} });

  const res = await app.inject({ method: 'GET', url: '/abc1234' });

  assert.equal(res.statusCode, 502);
});

test('a failing click publisher never breaks the redirect', async () => {
  const app = makeApp({
    fetchFn: found('https://example.com/target'),
    publishClick: () => {
      throw new Error('queue exploded');
    },
  });

  const res = await app.inject({ method: 'GET', url: '/abc1234' });

  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, 'https://example.com/target');
});

test('health endpoint reports ok', async () => {
  const app = makeApp({ fetchFn: unreachable, publishClick: () => {} });

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', service: 'redirect-service' });
});