const client = require('prom-client');

// One registry per app instance keeps tests isolated from each other
function createMetrics() {
  const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [register],
  });

  // Records every request except the health and metrics endpoints themselves
  function middleware(req, res, next) {
    if (req.path === '/metrics' || req.path === '/health') return next();
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      // The route pattern (not the raw URL) keeps the number of label values small
      const route = req.route ? req.baseUrl + req.route.path : 'unmatched';
      end({ method: req.method, route, status: res.statusCode });
    });
    next();
  }

  async function handler(req, res) {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  }

  return { middleware, handler };
}

module.exports = { createMetrics };