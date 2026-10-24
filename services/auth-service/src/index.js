const pool = require('./db');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET;

// Fail fast: never run with a missing secret
if (!JWT_SECRET) {
  console.error('JWT_SECRET is required');
  process.exit(1);
}

const app = createApp({
  pool,
  jwtSecret: JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
});

app.listen(PORT, () => {
  console.log(`auth-service listening on port ${PORT}`);
});