import { resolve } from 'node:path';
import { Pool } from 'pg';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { NullPublisher, connectPublisher } from './events.ts';
import { migrate } from './migrate.ts';
import { PgStore } from './store.ts';

const cfg = loadConfig();
const pool = new Pool({ connectionString: cfg.databaseUrl });
await migrate(pool, resolve(import.meta.dirname, '../migrations'));
const events = cfg.rabbitUrl ? await connectPublisher(cfg.rabbitUrl) : new NullPublisher();
createApp({ cfg, store: new PgStore(pool), events }).listen(cfg.port, () => console.log(`iam listening on ${cfg.port}`));
