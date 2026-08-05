import { NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { leerSesion } from '@/server/auth/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Sonda de salud para Docker y Cloudflare.
 *
 * Comprueba las cosas sin las que la app no sirve de nada:
 *   · la base responde,
 *   · las restricciones de integridad siguen puestas (una migración a medias
 *     dejaría pasar precios "Pendiente" con importe),
 *   · existe el binario de Chromium, o no habrá PDF,
 *   · están las fuentes y el logo del documento, que se leen del disco: si la
 *     imagen se construyó sin ellas, la app arranca y todo parece bien hasta
 *     que alguien pide un PDF en una junta,
 *   · se puede escribir en el volumen,
 *   · `pg_dump` está y es de la MISMA versión mayor que el servidor.
 *
 * ES PÚBLICA, y tiene que serlo: el HEALTHCHECK de Docker no puede autenticarse.
 * Pero sólo publica banderas sí/no. Los mensajes de error, los nombres de las
 * restricciones que falten y las versiones exactas de Postgres se devuelven
 * únicamente a quien tiene sesión: son el mapa de qué está roto y con qué
 * versión, y eso no se le cuenta a internet.
 */

/** Claves que sólo salen con sesión iniciada. */
const SOLO_CON_SESION = new Set([
  'dbError',
  'restriccionesFaltantes',
  'chromiumError',
  'documentoError',
  'almacenamientoError',
  'pgDumpError',
  'pgDumpVersiones',
])

export async function GET() {
  const detalle: Record<string, unknown> = {}
  let ok = true

  // ── Base de datos ──────────────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`
    detalle.db = true
  } catch (e) {
    ok = false
    detalle.db = false
    detalle.dbError = e instanceof Error ? e.message : String(e)
  }

  // ── Restricciones de negocio ───────────────────────────────────────────
  // Se cuentan los CHECK que el sistema da por hechos. Si faltan, la base
  // acepta datos que el resto del código considera imposibles.
  const CHECKS_ESPERADOS = [
    'tr_price_shape',
    'qp_base_shape',
    'qp_override_shape',
    'ql_price_source',
    'ql_free_shape',
    'ql_qty',
    'q_tax_bps',
    'q_folio_when_emitted',
    'q_total_ceiling',
    'q_totals_no_negativos',
  ]
  if (detalle.db === true) {
    try {
      const filas = await prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint WHERE contype = 'c'
      `
      const presentes = new Set(filas.map((f) => f.conname))
      const faltantes = CHECKS_ESPERADOS.filter((c) => !presentes.has(c))
      detalle.restricciones = faltantes.length === 0
      if (faltantes.length > 0) {
        ok = false
        detalle.restriccionesFaltantes = faltantes
      }
    } catch {
      ok = false
      detalle.restricciones = false
    }
  }

  // ── Chromium ───────────────────────────────────────────────────────────
  try {
    const ruta = process.env.CHROMIUM_EXECUTABLE_PATH
    if (ruta && ruta.length > 0) {
      detalle.chromium = existsSync(ruta)
    } else {
      // Playwright resuelve su propio navegador dentro de la imagen.
      const { chromium } = await import('playwright')
      detalle.chromium = existsSync(chromium.executablePath())
    }
    if (detalle.chromium !== true) ok = false
  } catch (e) {
    ok = false
    detalle.chromium = false
    detalle.chromiumError = e instanceof Error ? e.message : String(e)
  }

  // ── Recursos del documento ─────────────────────────────────────────────
  try {
    const { fuentesDocumento, logoDataUri } = await import('@/server/pdf/fuentes')
    const f = fuentesDocumento()
    const logo = logoDataUri()
    detalle.documento =
      f.regularWoff2Base64.length > 1_000 &&
      f.boldWoff2Base64.length > 1_000 &&
      logo.length > 1_000
    if (detalle.documento !== true) ok = false
  } catch (e) {
    ok = false
    detalle.documento = false
    detalle.documentoError = e instanceof Error ? e.message : String(e)
  }

  // ── Almacenamiento ─────────────────────────────────────────────────────
  // Los .xlsx importados y los PDFs emitidos van a un volumen. Si no está
  // montado o no se puede escribir, la app arranca y todo parece bien hasta
  // que alguien sube un archivo.
  try {
    const { mkdir, writeFile, unlink } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const dir = process.env.STORAGE_DIR ?? join(process.cwd(), 'var')
    const prueba = join(dir, '.escritura')
    await mkdir(dir, { recursive: true })
    await writeFile(prueba, 'ok')
    await unlink(prueba)
    detalle.almacenamiento = true
  } catch (e) {
    ok = false
    detalle.almacenamiento = false
    detalle.almacenamientoError = e instanceof Error ? e.message : String(e)
  }

  // ── Herramientas de respaldo ───────────────────────────────────────────
  // La app se respalda a sí misma antes de aplicar una importación. Si falta
  // pg_dump, esa importación se bloquea — mejor saberlo aquí.
  //
  // Y no basta con que EXISTA: pg_dump se niega a volcar de un servidor con
  // versión mayor a la suya. Con el cliente 15 de Debian contra postgres:16, el
  // binario responde a `--version` tan campante y esta sonda decía `pgDump:
  // true` mientras la importación del CRM quedaba bloqueada por completo. Se
  // comparan las dos mayores.
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const { stdout } = await promisify(execFile)('pg_dump', ['--version'], {
      timeout: 10_000,
    })

    const mayorCliente = Number(/(\d+)/.exec(stdout)?.[1])
    if (!Number.isFinite(mayorCliente)) {
      throw new Error(`no se pudo leer la versión de pg_dump: ${stdout.trim()}`)
    }

    let mayorServidor = mayorCliente
    if (detalle.db === true) {
      const filas = await prisma.$queryRaw<
        { server_version_num: string }[]
      >`SELECT current_setting('server_version_num') AS server_version_num`
      mayorServidor = Math.floor(Number(filas[0]?.server_version_num) / 10_000)
    }

    detalle.pgDumpVersiones = { cliente: mayorCliente, servidor: mayorServidor }

    // Un cliente MÁS NUEVO que el servidor sí funciona; al revés no.
    if (mayorCliente < mayorServidor) {
      throw new Error(
        `pg_dump es de PostgreSQL ${mayorCliente} y el servidor es ${mayorServidor}: ` +
          'se negará a volcar y la importación del CRM quedará bloqueada.',
      )
    }

    detalle.pgDump = true
  } catch (e) {
    // No tumba la salud general: la app funciona, sólo que no se podrá
    // importar hasta que esté. Se reporta para que se vea.
    detalle.pgDump = false
    detalle.pgDumpError = e instanceof Error ? e.message : String(e)
  }

  // Sin sesión, sólo las banderas. Que la sonda esté rota no es motivo para
  // negar el diagnóstico a quien sí puede verlo, así que un fallo al leer la
  // sesión se trata como "no hay sesión" y no como error.
  const conSesion = await leerSesion()
    .then((s) => s !== null)
    .catch(() => false)

  const cuerpo = conSesion
    ? detalle
    : Object.fromEntries(
        Object.entries(detalle).filter(([k]) => !SOLO_CON_SESION.has(k)),
      )

  return NextResponse.json(
    { ok, ...cuerpo, ts: new Date().toISOString() },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
