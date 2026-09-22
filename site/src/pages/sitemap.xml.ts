import type { APIRoute } from 'astro';

const routes = [
  '/',
  '/docs/',
  '/docs/getting-started/',
  '/docs/syncing/',
  '/docs/database-lifecycle/',
  '/docs/migrations/',
  '/docs/configuration/',
  '/docs/command-reference/',
];

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('https://supabee.jacobchak.com');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes
    .map((route) => `  <url><loc>${new URL(route, base).href}</loc></url>`)
    .join('\n')}\n</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
