import 'server-only'
import { z } from 'zod'

/**
 * Validación del entorno al arranque. Falla ruidosamente: es preferible que el
 * contenedor no levante a que Chuy descubra a media junta que los PDFs no se
 * generan porque faltaba una variable.
 */
const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

  APP_PUBLIC_URL: z.url('APP_PUBLIC_URL debe ser una URL completa'),
  PORT: z.coerce.number().int().positive().default(3000),

  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET debe tener al menos 32 caracteres'),
  SESSION_SLIDING_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(168),

  SEED_ADMIN_EMAIL: z.email().optional(),
  SEED_ADMIN_NOMBRE: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),

  STORAGE_DIR: z.string().min(1).default('/var/lib/katana'),

  /** Vacío ⇒ se usa el Chromium que Playwright trae en la imagen. */
  CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
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
