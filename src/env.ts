import 'server-only'
import { z } from 'zod'

/**
 * Validación del entorno al arranque. Falla ruidosamente: es preferible que el
 * contenedor no levante a que Chuy descubra a media junta que los PDFs no se
 * generan porque faltaba una variable.
 *
 * Se dispara desde `instrumentation.ts`, o sea al arrancar el proceso y no en el
 * primer clic. Antes sólo se cargaba al importar `session.ts`, y el resultado
 * era que `/api/health` respondía 200 —y `./deploy.sh` decía "responde
 * correctamente"— mientras todas las páginas daban 500.
 */

/**
 * Compose inyecta `${VAR:-}` como cadena VACÍA, no como variable ausente, y
 * `.optional()` de zod no acepta cadena vacía: quitar una variable declarada
 * opcional del `.env` tumbaba la app. Aquí una vacía se trata como ausente,
 * que es lo que cualquiera esperaría.
 */
function opcional<T extends z.ZodType>(esquema: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), esquema.optional())
}

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

  APP_PUBLIC_URL: z.url('APP_PUBLIC_URL debe ser una URL completa'),
  PORT: z.coerce.number().int().positive().default(3000),

  // No hay SESSION_SECRET: las sesiones son opacas y viven en la base, así que
  // no hay nada que firmar. Revocar de verdad es cerrar sesiones (se borran las
  // filas), no rotar un secreto.
  SESSION_SLIDING_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(168),

  SEED_ADMIN_EMAIL: opcional(z.email()),
  SEED_ADMIN_NOMBRE: opcional(z.string()),
  SEED_ADMIN_PASSWORD: opcional(z.string().min(12)),

  STORAGE_DIR: z.string().min(1).default('/var/lib/katana'),

  /** Vacío ⇒ se usa el Chromium que Playwright trae en la imagen. */
  CHROMIUM_EXECUTABLE_PATH: opcional(z.string()),
  PDF_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  PDF_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
})

function cargar() {
  const r = esquema.safeParse(process.env)
  if (!r.success) {
    const detalle = r.error.issues
      .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(
      `Configuración de entorno inválida.\n${detalle}\n\n` +
        'Revisa tu archivo .env contra .env.example.',
    )
  }
  return r.data
}

export const env = cargar()

export const esProduccion = env.NODE_ENV === 'production'
