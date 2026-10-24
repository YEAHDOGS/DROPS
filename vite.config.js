import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// Oldest browsers that get the full app: the first releases with CSS cascade layers, which Tailwind v4 requires.
// Anything older (down to the Chrome 40 Potato Target) gets the static fallback page in index.html instead.
const APP_CSS_TARGET = ['chrome99', 'edge99', 'firefox97', 'safari15.4', 'ios15.4']
// Safari stays at 16.4 for JS: lower makes Oxc rewrite every private class field into WeakMap helpers for ALL browsers.
const APP_JS_TARGET = ['chrome99', 'edge99', 'firefox97', 'safari16.4', 'ios16.4']
// `npm run dev:api` (wrangler dev) serves the Worker: API, live sockets and media.
const API = 'http://127.0.0.1:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  server: {
    proxy: {
      '/api': { target: API, ws: true },
      '/media': API,
    },
  },
  build: {
    target: APP_JS_TARGET,
    cssTarget: APP_CSS_TARGET,
  },
})
