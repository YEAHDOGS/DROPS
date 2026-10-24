import { defineConfig } from 'vitest/config'

// Kept apart from vite.config.js so tests skip the Svelte/Tailwind plugins.
export default defineConfig({ test: { include: ['test/**/*.test.js'] } })
