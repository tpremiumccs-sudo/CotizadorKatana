import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWorkbook, buscarHoja, detectarTipoArchivo } from '@/server/import/workbook'
import { detectHeaderRow, indicePorCanonico } from '@/server/import/header'
import { parsePrice } from '@/server/import/parse-price'
import { FORMATOS } from '@/server/import/catalogo'
import {
  SPEC_TARIFARIO, SPEC_PERFIL, SPEC_TALENTOS, SPEC_PROPUESTAS, SPEC_CATALOGOS,
  SPEC_ROSTER_BASE, SPEC_ROSTER_PERFIL, SPEC_KIF, SPEC_FIERA,
} from '@/server/import/spec'
import type { RejillaHoja } from '@/server/import/types'

/**
 * Lectura de los DOS archivos reales del CRM.
 *
 * No hay fixtures inventados: son los mismos `.xlsx` que usa la agencia. Si
 * mañana cambian de forma, estas pruebas lo dicen antes de que una importación
 * silenciosa deje el tarifario a medias.
 */

const DIR = join(import.meta.dirname, '../fixtures/xlsx')
const ARCHIVO_CRM = join(DIR, 'KATANA_ENGINE_CRM_COMERCIAL_2026.xlsx')
const ARCHIVO_ROSTER = join(DIR, 'CRM_Roster_Katana_Actualizado.xlsx')

let crm: RejillaHoja[]
let roster: RejillaHoja[]

beforeAll(async () => {
  crm = await readWorkbook(readFileSync(ARCHIVO_CRM))
  roster = await readWorkbook(readFileSync(ARCHIVO_ROSTER))
}, 120_000)

describe('lectura del archivo', () => {
  it('reconoce cuál de los dos archivos es', () => {
    expect(detectarTipoArchivo(crm)).toBe('CRM_COMERCIAL')
    expect(detectarTipoArchivo(roster)).toBe('ROSTER')
  })

  it('encuentra las hojas por nombre pese a guiones largos y acentos', () => {
    expect(buscarHoja(crm, 'TARIFARIO KATANA')).toBeDefined()
    expect(buscarHoja(crm, 'PERFIL COMERCIAL — CAPTURA')).toBeDefined()
    // Escrito con guion normal y sin acentos: debe encontrarla igual.
    expect(buscarHoja(crm, 'PERFIL COMERCIAL - CAPTURA')).toBeDefined()
    expect(buscarHoja(roster, 'KIF — Base de Talentos')).toBeDefined()
    expect(buscarHoja(roster, 'FIERA — Roster & Matchmaking')).toBeDefined()
  })
})

describe('detección de la fila de encabezados', () => {
  // Los índices reales, medidos. Están en filas distintas y por eso se detectan
  // en vez de codificarse.
  const CASOS: Array<[string, typeof SPEC_TARIFARIO, number, 'crm' | 'roster']> = [
    ['TARIFARIO KATANA', SPEC_TARIFARIO, 0, 'crm'],
    ['TALENTOS', SPEC_TALENTOS, 0, 'crm'],
    ['CATALOGOS', SPEC_CATALOGOS, 0, 'crm'],
    ['PROPUESTAS KATANA ENGINE', SPEC_PROPUESTAS, 0, 'crm'],
    ['PERFIL COMERCIAL — CAPTURA', SPEC_PERFIL, 1, 'crm'],
    ['Base de Talentos', SPEC_ROSTER_BASE, 3, 'roster'],
    ['Perfil comercial', SPEC_ROSTER_PERFIL, 3, 'roster'],
    ['KIF — Base de Talentos', SPEC_KIF, 0, 'roster'],
    ['FIERA — Roster & Matchmaking', SPEC_FIERA, 1, 'roster'],
  ]

  it.each(CASOS)(
    '%s: encabezado en la fila %s',
    (nombre, spec, filaEsperada, cual) => {
      const hoja = buscarHoja(cual === 'crm' ? crm : roster, nombre)
      expect(hoja, `falta la hoja ${nombre}`).toBeDefined()

      const d = detectHeaderRow(hoja!, spec)
      expect(d.filaEncabezado, `${nombre}: fila detectada`).toBe(filaEsperada)
      expect(d.requiereMapeoManual, `${nombre}: confianza ${d.confianza}`).toBe(false)
      expect(d.requeridosFaltantes, `${nombre}: encabezados faltantes`).toEqual([])
    },
  )

  it('salta la fila de ejemplo que el propio Excel marca para borrar', () => {
    const hoja = buscarHoja(crm, 'PERFIL COMERCIAL — CAPTURA')!
    const d = detectHeaderRow(hoja, SPEC_PERFIL)
    expect(d.filaEncabezado).toBe(1)
    // La fila 2 es "EJEMPLO / — borrar esta fila —": el primer dato es KT-001.
    expect(d.filaPrimerDato).toBe(3)
    const idx = indicePorCanonico(d)
    const primera = hoja.filas[d.filaPrimerDato]!
    expect(String(primera[idx.get('talent_id')!])).toBe('KT-001')
  })

  it('reporta las columnas con datos pero sin encabezado en TALENTOS', () => {
    // Hay una banda de columnas sin encabezado que arrastra precios sueltos.
    // Lo importante es que se reporte, no que se descarte.
    const hoja = buscarHoja(crm, 'TALENTOS')!
    const d = detectHeaderRow(hoja, SPEC_TALENTOS)
    expect(d.columnasSinEncabezado.length).toBeGreaterThan(0)
  })

  it('con una hoja que no corresponde, pide mapeo manual en vez de adivinar', () => {
    const hoja = buscarHoja(crm, 'DASHBOARD')!
    const d = detectHeaderRow(hoja, SPEC_TARIFARIO)
    expect(d.requiereMapeoManual).toBe(true)
    expect(d.requeridosFaltantes.length).toBeGreaterThan(0)
  })
})

describe('TARIFARIO: las 399 celdas de precio', () => {
  it('los 19 formatos del catálogo están en la hoja, y las 4 columnas que no son formato quedan fuera', () => {
    const hoja = buscarHoja(crm, 'TARIFARIO KATANA')!
    const d = detectHeaderRow(hoja, SPEC_TARIFARIO)
    const idx = indicePorCanonico(d)

    for (const f of FORMATOS) {
      expect(idx.has(f.excelHeader), `falta la columna ${f.excelHeader}`).toBe(true)
    }
    expect(FORMATOS).toHaveLength(19)

    // "Plataforma principal" existe en la hoja pero NO es un formato cotizable.
    expect(idx.has('Plataforma principal')).toBe(true)
    expect(FORMATOS.some((f) => f.excelHeader === 'Plataforma principal')).toBe(false)
  })

  it('reproduce el recuento exacto de estados de precio del archivo', () => {
    const hoja = buscarHoja(crm, 'TARIFARIO KATANA')!
    const d = detectHeaderRow(hoja, SPEC_TARIFARIO)
    const idx = indicePorCanonico(d)
    const colTalento = idx.get('Talento')!

    const conteo = { QUOTED: 0, PENDING: 0, NOT_APPLICABLE: 0, CASE_BY_CASE: 0 }
    let talentos = 0
    let noReconocidas = 0

    for (let i = d.filaPrimerDato; i < hoja.filas.length; i++) {
      const fila = hoja.filas[i]!
      const nombre = String(fila[colTalento] ?? '').trim()
      if (!nombre) continue
      talentos++

      for (const f of FORMATOS) {
        const p = parsePrice(fila[idx.get(f.excelHeader)!])
        if (!p.ok || !p.status) {
          noReconocidas++
          continue
        }
        conteo[p.status]++
      }
    }

    expect(talentos).toBe(21)
    expect(noReconocidas).toBe(0)
    // Medido sobre el archivo real: 399 celdas, ninguna vacía.
    expect(conteo.QUOTED).toBe(182)
    expect(conteo.NOT_APPLICABLE).toBe(93)
    expect(conteo.PENDING).toBe(87)
    expect(conteo.CASE_BY_CASE).toBe(37)
    expect(
      conteo.QUOTED + conteo.NOT_APPLICABLE + conteo.PENDING + conteo.CASE_BY_CASE,
    ).toBe(21 * 19)
  })

  it('lee las tarifas concretas que usa el tabulador de HONOR', () => {
    const hoja = buscarHoja(crm, 'TARIFARIO KATANA')!
    const d = detectHeaderRow(hoja, SPEC_TARIFARIO)
    const idx = indicePorCanonico(d)
    const colTalento = idx.get('Talento')!

    const porTalento = new Map<string, Record<string, ReturnType<typeof parsePrice>>>()
    for (let i = d.filaPrimerDato; i < hoja.filas.length; i++) {
      const fila = hoja.filas[i]!
      const nombre = String(fila[colTalento] ?? '').trim()
      if (!nombre) continue
      const fila2: Record<string, ReturnType<typeof parsePrice>> = {}
      for (const f of FORMATOS) fila2[f.code] = parsePrice(fila[idx.get(f.excelHeader)!])
      porTalento.set(nombre, fila2)
    }

    const ronny = porTalento.get('Ronny')!
    expect(ronny.TIKTOK!.amountCents).toBe(90_000_00)
    expect(ronny.REEL_IG!.amountCents).toBe(130_000_00)
    // El tarifario dice 195,000 y el PDF de HONOR imprime 150,000: ése es el
    // ajuste por cotización que el producto tiene que soportar.
    expect(ronny.TIKTOK_REEL_MIRROR!.amountCents).toBe(195_000_00)
    expect(ronny.STORY_IG!.amountCents).toBe(40_000_00)
    expect(ronny.DEDICATED_STREAM_HOUR!.status).toBe('CASE_BY_CASE')

    const mariel = porTalento.get('Mariel Estrella')!
    expect(mariel.TIKTOK!.amountCents).toBe(100_000_00)
    // En el tarifario están pendientes; el PDF las vende igual.
    expect(mariel.REEL_IG!.status).toBe('PENDING')
    expect(mariel.STORY_IG!.status).toBe('PENDING')
    expect(mariel.TIKTOK_REEL_MIRROR!.status).toBe('PENDING')

    const tony = porTalento.get('Tony Gastélum')!
    expect(tony.TIKTOK!.amountCents).toBe(30_000_00)
    expect(tony.REEL_IG!.amountCents).toBe(60_000_00)
    expect(tony.TIKTOK_REEL_MIRROR!.amountCents).toBe(90_000_00) // el PDF: 80,000
    expect(tony.REEL_COLLAB!.status).toBe('PENDING')

    const yoiker = porTalento.get('Yoiker')!
    expect(yoiker.TIKTOK!.amountCents).toBe(25_000_00)
    expect(yoiker.REEL_IG!.amountCents).toBe(40_000_00)
    expect(yoiker.TIKTOK_REEL_MIRROR!.amountCents).toBe(60_000_00)
    expect(yoiker.STORY_IG!.amountCents).toBe(20_000_00)

    // Divino Espinoza se cotiza caso por caso en todo el contenido social; el
    // único importe cerrado es el fee de pelea, que corresponde a la nota
    // "$750,000 por marca en short durante combate".
    const divino = porTalento.get('Divino Espinoza')!
    expect(divino.TIKTOK!.status).toBe('CASE_BY_CASE')
    expect(divino.EXCLUSIVITY_MONTHLY!.status).toBe('CASE_BY_CASE')
    expect(divino.FIGHT_FEE!.amountCents).toBe(750_000_00)
    expect(divino.FIGHT_FEE!.status).toBe('QUOTED')
    expect(divino.HOSTING!.status).toBe('NOT_APPLICABLE')
  })

  it('conserva íntegra la nota con el tarifario en prosa de Padigol', () => {
    const hoja = buscarHoja(crm, 'TARIFARIO KATANA')!
    const d = detectHeaderRow(hoja, SPEC_TARIFARIO)
    const idx = indicePorCanonico(d)
    const colTalento = idx.get('Talento')!
    const colNotas = idx.get('Notas')!

    const fila = hoja.filas.find(
      (f) => String(f[colTalento] ?? '').trim() === 'Padigol',
    )
    expect(fila).toBeDefined()
    const nota = String(fila![colNotas] ?? '')
    // Es un tarifario de paquetes escrito en prosa: se guarda tal cual, no se
    // intenta parsear ni se recorta.
    expect(nota.length).toBeGreaterThan(500)
    expect(nota).toContain('mención YouTube')
    expect(nota).toContain('paquete 15 menciones')
  })
})
