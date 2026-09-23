import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors';
import { verifyUserJwt, type AuthUser } from './jwt';

export type { AuthUser };

export async function requireUser(req: IncomingMessage): Promise<AuthUser> {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith('Bearer ')) throw new HttpError(401, 'missing bearer token');
  try {
    return await verifyUserJwt(value.slice('Bearer '.length).trim());
  } catch {
    throw new HttpError(401, 'invalid or expired token');
  }
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const preset = (req as IncomingMessage & { body?: unknown }).body;
  if (preset && typeof preset === 'object') return preset;
  if (typeof preset === 'string') {
    if (!preset.trim()) return {};
    return JSON.parse(preset) as unknown;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function api(
  fn: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        const errorName = error.status === 401
          ? 'unauthorized'
          : error.status === 405
            ? 'method_not_allowed'
            : error.status >= 500
              ? 'internal'
              : 'validation';
        sendJson(res, error.status, {
          error: errorName,
          message: error.message,
          ...(error.id ? { id: error.id } : {}),
        });
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(res, 400, { error: 'invalid_json', message: 'request body is not JSON' });
        return;
      }
      console.error(error);
      sendJson(res, 500, { error: 'internal' });
    }
  };
}
