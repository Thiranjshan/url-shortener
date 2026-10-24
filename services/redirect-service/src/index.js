const amqp = require('amqplib');
const { buildApp } = require('./app');

const PORT = process.env.PORT || 3001;
const URL_SERVICE_URL = process.env.URL_SERVICE_URL || 'http://localhost:3000';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://app:devpassword@localhost:5672';
const QUEUE = 'click_events';

let channel = null;

const app = buildApp({
  urlServiceUrl: URL_SERVICE_URL,
  publishClick: (event) => publishClick(event),
  logger: true,
});

// Connect to RabbitMQ, and keep retrying if it's unavailable or drops
async function connectQueue() {
  try {
    const conn = await amqp.connect(RABBITMQ_URL);
    conn.on('error', (err) => app.log.error(err, 'rabbitmq connection error'));
    conn.on('close', () => {
      app.log.warn('rabbitmq connection closed, retrying in 5s');
      channel = null;
      setTimeout(connectQueue, 5000);
    });
    channel = await conn.createChannel();
    await channel.assertQueue(QUEUE, { durable: true });
    app.log.info('connected to rabbitmq');
  } catch (err) {
    app.log.error(`rabbitmq connect failed (${err.message}), retrying in 5s`);
    setTimeout(connectQueue, 5000);
  }
}

// Fire-and-forget: a failure here must never break the redirect
function publishClick(event) {
  if (!channel) {
    app.log.warn('queue unavailable, click not recorded');
    return;
  }
  try {
    channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(event)), { persistent: true });
  } catch (err) {
    app.log.error(err, 'failed to publish click event');
  }
}

connectQueue();

app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});