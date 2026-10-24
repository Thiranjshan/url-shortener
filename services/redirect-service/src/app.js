const Fastify = require('fastify');

function buildApp({ urlServiceUrl, publishClick, fetchFn = fetch, logger = false }) {
  const app = Fastify({ logger });

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