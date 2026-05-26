import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sdkPath = path.resolve(__dirname, '../src/index.js');

// GitHub Pages serves the site at https://kunalkamble.github.io/geotab-smart-sdk/
// — so asset URLs need to be prefixed with the repo name in production builds.
// `npm run dev` ignores `base` and serves at the root.
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/geotab-smart-sdk/' : '/',
  plugins: [react()],
  resolve: {
    // Let Playground import the SDK with its real package name, the same way
    // a consumer would after `npm install geotab-smart-sdk`. The alias points
    // at the source files; Vite's dependency optimizer (esbuild under the
    // hood) takes care of the CommonJS → ESM conversion for us.
    alias: {
      'geotab-smart-sdk': sdkPath,
    },
  },
  optimizeDeps: {
    include: ['geotab-smart-sdk'],
  },
  build: {
    commonjsOptions: {
      // Production build path: ensure Rollup's CJS plugin transforms the
      // SDK source (it normally only touches node_modules).
      include: [/node_modules/, /\/src\//],
      transformMixedEsModules: true,
    },
  },
  server: { port: 5173, open: true },
});
