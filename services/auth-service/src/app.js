const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function createApp({ pool, jwtSecret, jwtExpiresIn = '1h' }) {
  if (!jwtSecret) {
    throw new Error('jwtSecret is required');
  }

  const app = express();
  app.use(express.json());

  const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

  function requireJwt(req, res, next) {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'missing bearer token' });
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      req.user = { id: Number(payload.sub), email: payload.email };
      next();
    } catch {
      res.status(401).json({ error: 'invalid or expired token' });
    }
  }

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'auth-service' });
  });

  // --- Users ---

  app.post('/register', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    try {
      const hash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email.toLowerCase(), hash]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'email already registered' });
      }
      console.error(err);
      res.status(500).json({ error: 'registration failed' });
    }
  });

  app.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    try {
      const result = await pool.query(
        'SELECT id, email, password_hash FROM users WHERE email = $1',
        [email.toLowerCase()]
      );
      const user = result.rows[0];
      const ok = user && (await bcrypt.compare(password, user.password_hash));
      if (!ok) {
        // Same message for unknown email and wrong password
        return res.status(401).json({ error: 'invalid credentials' });
      }

      const token = jwt.sign({ email: user.email }, jwtSecret, {
        subject: String(user.id),
        expiresIn: jwtExpiresIn,
      });
      res.json({ token, tokenType: 'Bearer', expiresIn: jwtExpiresIn });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'login failed' });
    }
  });

  // --- API keys (require a logged-in user) ---

  app.post('/api-keys', requireJwt, async (req, res) => {
    const key = 'sk_' + crypto.randomBytes(24).toString('hex');
    const prefix = key.slice(0, 11);

    try {
      await pool.query(
        'INSERT INTO api_keys (user_id, name, key_prefix, key_hash) VALUES ($1, $2, $3, $4)',
        [req.user.id, (req.body && req.body.name) || null, prefix, sha256(key)]
      );
      res.status(201).json({
        apiKey: key,
        keyPrefix: prefix,
        note: 'Store this now. It cannot be shown again.',
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed to create api key' });
    }
  });

  app.get('/api-keys', requireJwt, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, key_prefix, created_at, revoked_at
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
        [req.user.id]
      );
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed to list api keys' });
    }
  });

  app.delete('/api-keys/:id', requireJwt, async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE api_keys SET revoked_at = NOW()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [req.params.id, req.user.id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'api key not found' });
      }
      res.status(204).end();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'failed to revoke api key' });
    }
  });

  // --- Internal: other services call this to check credentials ---

  app.get('/verify', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'];
      if (apiKey) {
        const result = await pool.query(
          `SELECT u.id, u.email FROM api_keys k
           JOIN users u ON u.id = k.user_id
           WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
          [sha256(apiKey)]
        );
        if (!result.rows[0]) {
          return res.status(401).json({ valid: false, error: 'invalid api key' });
        }
        return res.json({ valid: true, method: 'api_key', user: result.rows[0] });
      }

      const [scheme, token] = (req.headers.authorization || '').split(' ');
      if (scheme === 'Bearer' && token) {
        const payload = jwt.verify(token, jwtSecret);
        return res.json({
          valid: true,
          method: 'jwt',
          user: { id: Number(payload.sub), email: payload.email },
        });
      }

      res.status(401).json({ valid: false, error: 'no credentials provided' });
    } catch (err) {
      if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return res.status(401).json({ valid: false, error: 'invalid or expired token' });
      }
      console.error(err);
      res.status(500).json({ error: 'verification failed' });
    }
  });

  return app;
}

module.exports = { createApp };