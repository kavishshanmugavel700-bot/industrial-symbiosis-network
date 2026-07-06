const app = require('./app');
const env = require('./config/env');
const { startSurplusAlertCron } = require('./jobs/surplusAlert.cron');

app.listen(env.port, () => {
  console.log(`[server] Industrial Symbiosis backend listening on port ${env.port} (${env.nodeEnv})`);
  startSurplusAlertCron();
});
