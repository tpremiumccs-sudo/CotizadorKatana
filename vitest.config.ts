import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` existe para que Next falle si un módulo de servidor se
      // cuela en el cliente. En Vitest no hay tal frontera, así que se anula.
      'server-only': fileURLToPath(new URL('./tests/vacio.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // El importador lee .xlsx reales y el render de PDF arranca Chromium.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/server/pricing/**', 'src/lib/money.ts', 'src/server/import/**'],
      thresholds: {
        // El motor de cálculo es dinero que ve una marca: cobertura total.
        'src/server/pricing/compute.ts': {
          lines: 100,
          functions: 100,
          branches: 95,
        },
      },
    },
  },
})
