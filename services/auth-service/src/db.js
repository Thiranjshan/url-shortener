const { Pool } = require('pg');

module.exports = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'devpassword',
  database: process.env.DB_NAME || 'authdb',
});