import { brand, theme } from '../shared/theme.js';
import { HttpError } from './_lib/errors.js';
import { api } from './_lib/http.js';

const colors = theme.dark;

const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="88" height="88" role="img" aria-label="${brand.name}"><rect width="200" height="200" rx="46" fill="${theme.light.primary}"/><g transform="translate(-2,-9)"><circle cx="68" cy="80" r="13" fill="${theme.light.accent}"/><path d="M120 82 Q134 68 148 82" stroke="${theme.light.accent}" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M56 122 L86 150 L140 108" stroke="${theme.light.accent}" stroke-width="18" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;

function page(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${brand.name}</title>
  <meta name="description" content="${brand.tagline}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${colors.background}; color: ${colors.text}; font-family: Poppins, system-ui, sans-serif; }
    main { text-align: center; padding: 32px 24px; max-width: 28rem; }
    h1 { margin: 20px 0 8px; font-weight: 800; font-size: 2.4rem; letter-spacing: -0.03em; }
    h1 span { color: ${theme.light.accent}; }
    .tagline { margin: 0; font-weight: 600; font-size: 1.05rem; }
    p { color: ${colors.textMuted}; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    ${mark}
    <h1>allsquare<span>;)</span></h1>
    <p class="tagline">${brand.tagline}</p>
    <p>One person logs the shared expenses. Everyone else opens a link.</p>
  </main>
</body>
</html>`;
}

export default api(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'method not allowed');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method === 'HEAD') res.end();
  else res.end(page());
});
