import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site at https://kunalkamble.github.io/geotab-smart-sdk/
// — so asset URLs need to be prefixed with the repo name in production builds.
// `npm run dev` ignores `base` and serves at the root.
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/geotab-smart-sdk/' : '/',
  plugins: [react()],
  server: { port: 5173, open: true },
});
