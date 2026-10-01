import { theme, brand } from '../shared/theme.js';
import { withTransaction } from './_lib/db.js';
import { HttpError } from './_lib/errors.js';
import { api } from './_lib/http.js';

const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="72" height="72" aria-hidden="true"><rect width="200" height="200" rx="46" fill="${theme.light.primary}"/><g transform="translate(-2,-9)"><circle cx="68" cy="80" r="13" fill="${theme.light.accent}"/><path d="M120 82 Q134 68 148 82" stroke="${theme.light.accent}" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M56 122 L86 150 L140 108" stroke="${theme.light.accent}" stroke-width="18" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;

function page(active: boolean): string {
  const colors = theme.dark;
  const heading = active ? brand.name : 'Link no longer active';
  const copy = active
    ? 'This share link is active. Balances and the UPI button arrive with sharing.'
    : 'Link no longer active.';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${heading}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${colors.background}; color: ${colors.text}; font-family: Poppins, system-ui, sans-serif; }
    main { text-align: center; padding: 32px; }
    p { color: ${colors.textMuted}; }
  </style>
</head>
<body>
  <main>
    ${mark}
    <h1>${heading}</h1>
    <p>${copy}</p>
  </main>
</body>
</html>`;
}

function tokenOf(url: string | undefined): string | null {
  if (!url) return null;
  const parsed = new URL(url, 'http://localhost');
  return parsed.searchParams.get('token');
}

export default api(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
  const token = tokenOf(req.url);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!token) {
    res.statusCode = 404;
    res.end(page(false));
    return;
  }

  const active = await withTransaction(async (client) => {
    const result = await client.query(
      `select revoked_at from allsquare.share_links where token = $1`,
      [token],
    );
    const row = result.rows[0] as { revoked_at: string | Date | null } | undefined;
    return Boolean(row && row.revoked_at == null);
  });

  res.statusCode = active ? 200 : 404;
  res.end(page(active));
});
