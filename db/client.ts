import ws from 'ws';
import { neonConfig, Pool, types, type Pool as NeonPool } from '@neondatabase/serverless';

let configured = false;

function configureDriver(): void {
  if (configured) return;
  const socket = typeof ws === 'function' ? ws : (ws as { default?: unknown }).default;
  if (typeof socket !== 'function') throw new Error('ws driver failed to load');
  neonConfig.webSocketConstructor = socket as typeof ws;
  types.setTypeParser(20, (value) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`bigint out of safe integer range: ${value}`);
    }
    return parsed;
  });
  types.setTypeParser(1082, (value) => value);
  types.setTypeParser(1700, (value) => Number(value));
  configured = true;
}

export function createPool(): NeonPool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  configureDriver();
  return new Pool({ connectionString });
}
