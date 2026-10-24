// Forwards all four services to localhost so the smoke test can run against the cluster.
// Press Ctrl+C to stop them all.
const { spawn } = require('child_process');

const forwards = [
  ['svc/url-service', '3000:3000'],
  ['svc/redirect-service', '3001:3001'],
  ['svc/auth-service', '3002:3002'],
  ['svc/analytics-service', '8000:8000'],
];

const children = forwards.map(([target, ports]) => {
  const child = spawn('kubectl', ['port-forward', '-n', 'url-shortener', target, ports], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => console.log(`port-forward ${target} exited (code ${code})`));
  return child;
});

function shutdown() {
  children.forEach((c) => c.kill());
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);