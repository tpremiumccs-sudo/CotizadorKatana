import { defineConfig, devices } from '@playwright/test'

/**
 * Pruebas de extremo a extremo.
 *
 * Los tres perfiles son los tres sitios donde se usa el cotizador de verdad:
 * el escritorio de la oficina, el iPad que se enseña en la junta y el celular
 * desde el que se manda el PDF por WhatsApp. Que funcione en uno no dice nada
 * de los otros, así que las mismas pruebas corren en los tres.
 */

const PUERTO = Number(process.env.E2E_PORT ?? 3210)
const BASE = `http://127.0.0.1:${PUERTO}`

export default defineConfig({
  testDir: './tests/e2e',
  // Comparten una sola base de datos: en paralelo se pisan.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE,
    // El documento vive en un iframe de mismo origen; sin esto no se puede
    // inspeccionar lo que ve el usuario.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    launchOptions: {
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },

  projects: [
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'ipad-vertical',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        isMobile: false,
        hasTouch: true,
      },
    },
    {
      name: 'iphone-14',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: false,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],

  // El servidor se levanta ya construido: `next dev` recompila en la primera
  // visita a cada ruta y convertiría cualquier medición de tiempo en ruido.
  webServer: {
    command: `node .next/standalone/server.js`,
    url: `${BASE}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(PUERTO),
      HOSTNAME: '127.0.0.1',
    },
  },
})
