import ws from 'ws';
import { neonConfig, Pool, types, type Pool as NeonPool } from '@neondatabase/serverless';

neonConfig.webSocketConstructor = ws;

types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`bigint out of safe integer range: ${value}`);
  }
  return parsed;
});
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1700, (value) => Number(value));

export function createPool(): NeonPool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new Pool({ connectionString });
}
