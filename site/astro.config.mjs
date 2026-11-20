import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://supabee.jacobchak.com',
  output: 'static',
  redirects: {
    '/docs/commands/db-seed-remote/': '/docs/commands/seed/',
    '/docs/commands/migration-split-mixed/': '/docs/commands/migration-split/',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
