import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Carga `.env` para las pruebas.
 *
 * Next lo hace solo cuando arranca la app, pero Vitest no. Sin esto, las
 * pruebas de integración fallan con un error de conexión que no dice nada.
 * Las variables que ya existan en el entorno mandan: así CI puede apuntar a
 * otra base sin tocar el archivo.
 */
const ruta = join(import.meta.dirname, '..', '.env')
if (existsSync(ruta)) {
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(linea)
    if (!m) continue
    const clave = m[1]!
    if (process.env[clave] !== undefined) continue
    process.env[clave] = m[2]!.trim().replace(/^["'](.*)["']$/, '$1')
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Falta DATABASE_URL. Copia .env.example a .env, o expórtala en el entorno.',
  )
}
