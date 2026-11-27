import { createApp, runSweep } from './app.js';
import { config } from './config.js';

const app = createApp();
setInterval(runSweep, 60_000).unref();
runSweep();
app.listen(config.port, () => console.log(`Kelishen running: ${config.publicUrl}`));
