import 'server-only'
import { execFile } from 'node:child_process'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const ejecutar = promisify(execFile)

/**
 * Respaldo puntual antes de una operación irreversible.
 *
 * Aplicar una importación reescribe el tarifario completo y no hay "deshacer":
 * revertirlo bien exigiría guardar el estado anterior de ~400 tarifas y sus
 * relaciones, que es exactamente lo que ya hace un `pg_dump` — más barato, más
 * completo y verificable.
 *
 * Si el respaldo falla, la importación NO se aplica. Es la mitad que importa:
 * un respaldo que se salta en silencio no protege de nada.
 */

const TIEMPO_MAXIMO_MS = 120_000

export class RespaldoFallidoError extends Error {
  constructor(motivo: string) {
    super(
      `No se pudo respaldar antes de aplicar, así que no se aplicó nada: ${motivo}`,
    )
    this.name = 'RespaldoFallidoError'
  }
}

/** Traduce la URL de conexión a lo que entienden pg_dump y compañía. */
function entornoDePg(url: string): NodeJS.ProcessEnv {
  const u = new URL(url)
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, ''),
  }
}

export interface Respaldo {
  ruta: string
  bytes: number
}

/**
 * Vuelca la base a `<STORAGE_DIR>/respaldos-previos/`.
 *
 * `etiqueta` acaba en el nombre del archivo para poder relacionarlo con lo que
 * se iba a hacer.
 */
export async function respaldarAntesDe(etiqueta: string): Promise<Respaldo> {
  const url = process.env.DATABASE_URL
  if (!url) throw new RespaldoFallidoError('falta DATABASE_URL')

  const base = process.env.STORAGE_DIR ?? join(process.cwd(), 'var')
  const dir = join(base, 'respaldos-previos')
  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const limpia = etiqueta.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40)
  const destino = join(dir, `previo-${limpia}-${sello}.dump`)
  const parcial = `${destino}.parcial`

  await mkdir(dir, { recursive: true })

  try {
    // Formato custom: comprimido y restaurable de forma selectiva.
    await ejecutar(
      'pg_dump',
      ['--format=custom', '--compress=9', `--file=${parcial}`],
      { env: entornoDePg(url), timeout: TIEMPO_MAXIMO_MS },
    )
  } catch (e) {
    await unlink(parcial).catch(() => {})
    const mensaje = e instanceof Error ? e.message : String(e)
    throw new RespaldoFallidoError(
      mensaje.includes('ENOENT')
        ? 'no está instalado pg_dump en el contenedor de la aplicación'
        : mensaje,
    )
  }

  // Se lee de vuelta antes de darlo por bueno: un volcado corrupto que nadie
  // comprueba es peor que no tener respaldo, porque da falsa tranquilidad.
  try {
    await ejecutar('pg_restore', ['--list', parcial], {
      env: entornoDePg(url),
      timeout: TIEMPO_MAXIMO_MS,
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch {
    await unlink(parcial).catch(() => {})
    throw new RespaldoFallidoError('el volcado no se pudo volver a leer')
  }

  // Sólo ahora toma el nombre definitivo: un respaldo a medias nunca aparece
  // como si estuviera completo.
  await rename(parcial, destino)
  const { size } = await stat(destino)
  return { ruta: destino, bytes: size }
}
