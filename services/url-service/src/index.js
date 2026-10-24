const pool = require('./db');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;

const app = createApp({
  pool,
  baseUrl: process.env.BASE_URL || 'http://localhost:3001',
  authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:3002',
});

app.listen(PORT, () => {
  console.log(`url-service listening on port ${PORT}`);
});