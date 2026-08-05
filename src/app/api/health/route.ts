import { NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Sonda de salud para Docker y Cloudflare.
 *
 * Comprueba las CUATRO cosas sin las que la app no sirve de nada:
 *   · la base responde,
 *   · las restricciones de integridad siguen puestas (una migración a medias
 *     dejaría pasar precios "Pendiente" con importe),
 *   · existe el binario de Chromium, o no habrá PDF,
 *   · están las fuentes y el logo del documento, que se leen del disco: si la
 *     imagen se construyó sin ellas, la app arranca y todo parece bien hasta
 *     que alguien pide un PDF en una junta.
 */
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

  return NextResponse.json(
    { ok, ...detalle, ts: new Date().toISOString() },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
