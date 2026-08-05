import { NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Sonda de salud para Docker y Cloudflare.
 *
 * Comprueba las TRES cosas sin las que la app no sirve de nada:
 *   · la base responde,
 *   · las restricciones de integridad siguen puestas (una migración a medias
 *     dejaría pasar precios "Pendiente" con importe),
 *   · existe el binario de Chromium, o no habrá PDF.
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

  return NextResponse.json(
    { ok, ...detalle, ts: new Date().toISOString() },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
