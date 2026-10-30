const Fastify = require('fastify');
const client = require('prom-client');

function buildApp({ urlServiceUrl, publishClick, fetchFn = fetch, logger = false }) {
  const app = Fastify({ logger });

    const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [register],
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions && request.routeOptions.url;
    if (!route || route === '/metrics' || route === '/health') return;
    httpDuration.observe(
      { method: request.method, route, status: reply.statusCode },
      reply.elapsedTime / 1000
    );
  });

  app.get('/metrics', async (request, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });

  app.get('/health', async () => ({ status: 'ok', service: 'redirect-service' }));

  app.get('/:shortCode', async (request, reply) => {
    const { shortCode } = request.params;

    try {
      const res = await fetchFn(`${urlServiceUrl}/urls/${shortCode}`);

      if (res.status === 404) {
        return reply.code(404).send({ error: 'short code not found' });
      }
      if (!res.ok) {
        return reply.code(502).send({ error: 'upstream service error' });
      }

      const { originalUrl } = await res.json();

      // Recording a click must never be able to break a redirect
      try {
        publishClick({
          shortCode,
          timestamp: new Date().toISOString(),
          userAgent: request.headers['user-agent'] || null,
          referer: request.headers['referer'] || null,
          ip: request.ip,
        });
      } catch (err) {
        request.log.warn(err, 'failed to publish click event');
      }

      return reply.redirect(originalUrl, 302);
    } catch (err) {
      request.log.error(err);
      return reply.code(502).send({ error: 'url-service unreachable' });
    }
  });

  return app;
}

module.exports = { buildApp };