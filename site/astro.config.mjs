import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://supabee.jacobchak.com',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
