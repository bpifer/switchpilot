import { startTracing } from './tracing.js';
await startTracing();   // must run before other imports are exercised

import { config } from './config.js';
import { buildApp } from './app.js';
import { migrate, seedAdmin } from './db.js';
import { redis, initPubSub } from './redis.js';
import { startScheduler } from './scheduler.js';
import { startLeaderElection } from './leader.js';
import { startSyslogListener } from './services/syslogService.js';
import { loadOuiCache, syncOuiDatabase } from './services/ouiService.js';

async function main() {
  await migrate();
  await seedAdmin();
  const app = await buildApp();

  await redis.connect().catch(err => app.log.warn(`redis unavailable: ${err.message}`));
  await initPubSub().catch(err => app.log.warn(`redis pub/sub unavailable: ${err.message}`));

  // MAC vendor lookups: load what we have now, sync the IEEE registry in the
  // background (first boot or staler than 30 days), then reload the cache.
  await loadOuiCache().catch(err => app.log.warn(`OUI cache load failed: ${err.message}`));
  syncOuiDatabase(msg => app.log.info(msg))
    .then(() => loadOuiCache())
    .catch(err => app.log.warn(`OUI sync skipped: ${err.message}`));

  // Contend for scheduler leadership, then start the sweeps (leader-gated inside).
  await startLeaderElection();
  startScheduler();
  startSyslogListener();

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`SwitchPilot API listening on :${config.port}${config.enableDocs ? ' — docs at /docs' : ''}`);
}

main().catch(err => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
