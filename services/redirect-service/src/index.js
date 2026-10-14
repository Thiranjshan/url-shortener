const fastify = require('fastify')({ logger: true });
const amqp = require('amqplib');

const PORT = process.env.PORT || 3001;
const URL_SERVICE_URL = process.env.URL_SERVICE_URL || 'http://localhost:3000';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://app:devpassword@localhost:5672';
const QUEUE = 'click_events';

let channel = null;

// Connect to RabbitMQ, and keep retrying if it's unavailable or drops
async function connectQueue() {
  try {
    const conn = await amqp.connect(RABBITMQ_URL);
    conn.on('error', (err) => fastify.log.error(err, 'rabbitmq connection error'));
    conn.on('close', () => {
      fastify.log.warn('rabbitmq connection closed, retrying in 5s');
      channel = null;
      setTimeout(connectQueue, 5000);
    });
    channel = await conn.createChannel();
    await channel.assertQueue(QUEUE, { durable: true });
    fastify.log.info('connected to rabbitmq');
  } catch (err) {
    fastify.log.error(`rabbitmq connect failed (${err.message}), retrying in 5s`);
    setTimeout(connectQueue, 5000);
  }
}

// Fire-and-forget: a failure here must never break the redirect
function publishClick(event) {
  if (!channel) {
    fastify.log.warn('queue unavailable, click not recorded');
    return;
  }
  try {
    channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(event)), { persistent: true });
  } catch (err) {
    fastify.log.error(err, 'failed to publish click event');
  }
}

fastify.get('/health', async () => {
  return { status: 'ok', service: 'redirect-service' };
});

fastify.get('/:shortCode', async (request, reply) => {
  const { shortCode } = request.params;

  try {
    const res = await fetch(`${URL_SERVICE_URL}/urls/${shortCode}`);

    if (res.status === 404) {
      return reply.code(404).send({ error: 'short code not found' });
    }
    if (!res.ok) {
      return reply.code(502).send({ error: 'upstream service error' });
    }

    const { originalUrl } = await res.json();

    publishClick({
      shortCode,
      timestamp: new Date().toISOString(),
      userAgent: request.headers['user-agent'] || null,
      referer: request.headers['referer'] || null,
      ip: request.ip,
    });

    return reply.redirect(originalUrl, 302);
  } catch (err) {
    request.log.error(err);
    return reply.code(502).send({ error: 'url-service unreachable' });
  }
});

connectQueue();

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});