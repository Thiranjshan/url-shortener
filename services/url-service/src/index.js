const express = require('express');
const { nanoid } = require('nanoid');
const pool = require('./db');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3002';

// Ask auth-service whether the caller's credentials are valid
async function requireAuth(req, res, next) {
  const headers = {};
  if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
  if (req.headers['x-api-key']) headers['X-API-Key'] = req.headers['x-api-key'];

  if (!headers['Authorization'] && !headers['X-API-Key']) {
    return res.status(401).json({ error: 'authentication required' });
  }

  try {
    const r = await fetch(`${AUTH_SERVICE_URL}/verify`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (r.status === 401) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    if (!r.ok) {
      return res.status(503).json({ error: 'authentication unavailable' });
    }
    const { user } = await r.json();
    req.user = user;
    next();
  } catch (err) {
    console.error('auth-service unreachable:', err.message);
    res.status(503).json({ error: 'authentication unavailable' });
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'url-service' });
});

// Create a short URL (authenticated)
app.post('/urls', requireAuth, async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
  } catch {
    return res.status(400).json({ error: 'url must be a valid http or https URL' });
  }

  const shortCode = nanoid(7);

  try {
    await pool.query(
      'INSERT INTO urls (short_code, original_url, user_id) VALUES ($1, $2, $3)',
      [shortCode, url, req.user.id]
    );

    res.status(201).json({
      shortCode,
      originalUrl: url,
      shortUrl: `${BASE_URL}/${shortCode}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to create short url' });
  }
});

// Look up the original URL (internal: called by redirect-service)
app.get('/urls/:shortCode', async (req, res) => {
  const { shortCode } = req.params;

  try {
    const result = await pool.query(
      'SELECT original_url FROM urls WHERE short_code = $1',
      [shortCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'short code not found' });
    }

    res.json({ shortCode, originalUrl: result.rows[0].original_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to look up short url' });
  }
});

app.listen(PORT, () => {
  console.log(`url-service listening on port ${PORT}`);
});