import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://supabee.jacobchak.com',
  output: 'static',
  redirects: {
    '/docs/commands/db-seed-remote/': '/docs/commands/seed/',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
