import http from 'k6/http';
import { check, fail } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const LINKS = Number(__ENV.LINKS || 20);
const QUICK = __ENV.QUICK === '1';

export const options = {
  scenarios: {
    redirects: {
      executor: 'ramping-arrival-rate', // fixed requests per second, whatever the server does
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: QUICK
        ? [{ target: 10, duration: '15s' }]
        : [
            { target: 25, duration: '1m' },
            { target: 50, duration: '1m' },
            { target: 100, duration: '1m' },
            { target: 200, duration: '1m' },
            { target: 300, duration: '1m' },
            { target: 0, duration: '30s' },
          ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// Runs once before the test: make an account and a pool of links to hit
export function setup() {
  const email = `load-${Date.now()}@example.com`;
  const password = 'load-test-pass-123';
  const json = { headers: { 'Content-Type': 'application/json' } };

  const reg = http.post(`${BASE_URL}/api/auth/register`, JSON.stringify({ email, password }), json);
  if (reg.status !== 201) fail(`register failed: ${reg.status}`);

  const login = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email, password }), json);
  const token = login.json('token');
  if (!token) fail(`login failed: ${login.status}`);

  const codes = [];
  for (let i = 0; i < LINKS; i++) {
    const res = http.post(
      `${BASE_URL}/api/urls`,
      JSON.stringify({ url: `https://example.com/load-test/${i}` }),
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
    );
    if (res.status !== 201) fail(`create failed: ${res.status}`);
    codes.push(res.json('shortCode'));
  }
  return { codes };
}

// Runs for every simulated request: follow a random short link, without following the redirect
export default function (data) {
  const code = data.codes[Math.floor(Math.random() * data.codes.length)];
  const res = http.get(`${BASE_URL}/${code}`, {
    redirects: 0,
    tags: { name: 'GET /{code}' },
  });
  check(res, { 'is a 302 redirect': (r) => r.status === 302 });
}