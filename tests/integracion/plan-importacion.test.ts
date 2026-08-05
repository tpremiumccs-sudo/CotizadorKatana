import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readWorkbook, sha256, detectarTipoArchivo } from '@/server/import/workbook'
import { buildImportPlan, type ContextoPlan } from '@/server/import/plan'
import { ALIAS_SEMBRADOS, normalizeName, type TalentoConocido } from '@/server/import/identity'
import type { PlanImportacion, RejillaHoja } from '@/server/import/types'

/**
 * El plan de importación, construido contra los DOS archivos reales.
 *
 * Aquí se comprueba lo que de verdad importa antes de tocar la base: que se
 * lee todo, que nada se pierde en silencio, que nadie se fusiona por error y
 * que aplicar dos veces el mismo archivo no cambia nada la segunda vez.
 */

const DIR = join(import.meta.dirname, '../fixtures/xlsx')
let crm: RejillaHoja[]
let roster: RejillaHoja[]
let bufCrm: Buffer

beforeAll(async () => {
  bufCrm = readFileSync(join(DIR, 'KATANA_ENGINE_CRM_COMERCIAL_2026.xlsx'))
  crm = await readWorkbook(bufCrm)
  roster = await readWorkbook(readFileSync(join(DIR, 'CRM_Roster_Katana_Actualizado.xlsx')))
}, 120_000)

const ctxVacio = (archivo: string, buf: Buffer): ContextoPlan => ({
  talentosConocidos: [],
  tarifasActuales: [],
  archivo,
  sha256: sha256(buf),
})

describe('primera importación (base vacía)', () => {
  let plan: PlanImportacion

  beforeAll(() => {
    plan = buildImportPlan(crm, 'CRM_COMERCIAL', ctxVacio('CRM.xlsx', bufCrm))
  })

  it('no lanza y detecta las hojas esperadas', () => {
    expect(plan.tipo).toBe('CRM_COMERCIAL')
    const nombres = plan.hojasDetectadas.map((h) => h.hoja)
    expect(nombres).toContain('TARIFARIO KATANA')
    expect(nombres).toContain('PERFIL COMERCIAL — CAPTURA')
    expect(nombres).toContain('TALENTOS')
    // Ninguna hoja quedó sin reconocer.
    for (const h of plan.hojasDetectadas) {
      expect(h.deteccion.requiereMapeoManual, `${h.hoja}`).toBe(false)
    }
  })

  it('con la base vacía, todos los talentos son altas', () => {
    expect(plan.talentos.length).toBeGreaterThanOrEqual(21)
    expect(plan.resumen.aCrear).toBe(plan.talentos.length)
    expect(plan.resumen.aActualizar).toBe(0)
    // Sin nada con qué comparar, no puede haber ambigüedad de identidad.
    expect(plan.resumen.requierenRevision).toBe(0)
  })

  it('trae las 21 filas del tarifario con sus 19 formatos', () => {
    const conTarifas = plan.talentos.filter((t) => t.cambiosTarifas.length > 0)
    expect(conTarifas).toHaveLength(21)
    for (const t of conTarifas) {
      expect(t.cambiosTarifas, t.crudo).toHaveLength(19)
    }
  })

  it('reporta las 19 filas huérfanas de TALENTOS sin descartar ninguna', () => {
    const huerfanas = plan.incidencias.filter(
      (i) =>
        i.hoja === 'TALENTOS' &&
        (i.codigo === 'FILA_HUERFANA' || i.codigo === 'BANDA_COLUMNAS_DESPLAZADA') &&
        i.fila !== undefined,
    )
    expect(huerfanas).toHaveLength(19)
    // Cada una lleva su volcado crudo: nada se pierde.
    for (const h of huerfanas) {
      expect(h.crudo, `fila ${h.fila}`).toBeTruthy()
      expect(Object.keys(h.crudo as object).length).toBeGreaterThan(0)
    }
  })

  it('conserva íntegra la nota con el tarifario en prosa de Padigol', () => {
    const padigol = plan.talentos.find((t) => t.crudo === 'Padigol')
    expect(padigol).toBeDefined()
    const nota = padigol!.cambiosTalento.rateNotes?.despues as string
    expect(nota.length).toBeGreaterThan(500)
    expect(nota).toContain('paquete 45 menciones')
  })

  it('asocia los códigos KT-XXX del perfil comercial', () => {
    const conCodigo = plan.talentos.filter((t) => t.codigo)
    expect(conCodigo.length).toBeGreaterThanOrEqual(20)
    for (const t of conCodigo) {
      expect(t.codigo, t.crudo).toMatch(/^KT-\d{3}$/)
    }
  })

  it('ningún precio del tarifario queda sin reconocer', () => {
    const noReconocidos = plan.talentos.flatMap((t) =>
      t.incidencias.filter((i) => i.codigo === 'PRECIO_NO_RECONOCIDO'),
    )
    expect(noReconocidos).toEqual([])
  })
})

describe('segunda importación (idempotencia)', () => {
  it('re-importar el mismo archivo no produce ningún cambio', () => {
    // Se simula el estado tras aplicar la primera importación.
    const primero = buildImportPlan(crm, 'CRM_COMERCIAL', ctxVacio('CRM.xlsx', bufCrm))

    const conocidos: TalentoConocido[] = primero.talentos.map((t, i) => ({
      talentId: `id-${i}`,
      codigo: t.codigo,
      canonicalName: t.crudo,
      displayName: t.displayName,
      identificadores: [normalizeName(t.crudo), normalizeName(t.displayName)],
    }))

    const tarifas = primero.talentos.flatMap((t, i) =>
      t.cambiosTarifas.map((c) => ({
        talentId: `id-${i}`,
        deliverableCode: c.deliverableCode,
        amountCents: c.despuesAmountCents,
        priceStatus: c.despuesPriceStatus,
        editadaAMano: false,
      })),
    )

    const segundo = buildImportPlan(crm, 'CRM_COMERCIAL', {
      talentosConocidos: conocidos,
      tarifasActuales: tarifas,
      archivo: 'CRM.xlsx',
      sha256: sha256(bufCrm),
    })

    expect(segundo.resumen.aCrear).toBe(0)
    expect(segundo.resumen.requierenRevision).toBe(0)
    expect(segundo.resumen.tarifasNuevas).toBe(0)
    expect(segundo.resumen.tarifasModificadas).toBe(0)
    expect(segundo.ausentes).toEqual([])

    // Ningún talento propone cambios de tarifa la segunda vez.
    const conCambios = segundo.talentos.filter((t) => t.cambiosTarifas.length > 0)
    expect(conCambios.map((t) => t.crudo)).toEqual([])
  })

  it('una tarifa editada a mano en la app se marca como conflicto y se conserva', () => {
    const primero = buildImportPlan(crm, 'CRM_COMERCIAL', ctxVacio('CRM.xlsx', bufCrm))
    const ronny = primero.talentos.find((t) => t.crudo === 'Ronny')!

    const conocidos: TalentoConocido[] = [{
      talentId: 'ronny-id', codigo: ronny.codigo, canonicalName: 'Ronny',
      displayName: 'Ronny', identificadores: ['ronny'],
    }]

    // El usuario bajó el espejo de Ronny a $150,000 dentro de la app; el Excel
    // sigue diciendo $195,000. Es exactamente el caso del tabulador de HONOR.
    const tarifas = ronny.cambiosTarifas.map((c) => ({
      talentId: 'ronny-id',
      deliverableCode: c.deliverableCode,
      amountCents:
        c.deliverableCode === 'TIKTOK_REEL_MIRROR' ? 150_000_00 : c.despuesAmountCents,
      priceStatus: c.despuesPriceStatus,
      editadaAMano: c.deliverableCode === 'TIKTOK_REEL_MIRROR',
    }))

    const segundo = buildImportPlan(crm, 'CRM_COMERCIAL', {
      talentosConocidos: conocidos, tarifasActuales: tarifas,
      archivo: 'CRM.xlsx', sha256: sha256(bufCrm),
    })

    const ronny2 = segundo.talentos.find((t) => t.crudo === 'Ronny')!
    const espejo = ronny2.cambiosTarifas.find((c) => c.deliverableCode === 'TIKTOK_REEL_MIRROR')

    expect(espejo).toBeDefined()
    expect(espejo!.conflicto).toBe(true)
    // Por omisión gana lo que hay en la app: el archivo no pisa una edición.
    expect(espejo!.resolucion).toBe('CONSERVAR_APP')
    expect(espejo!.antesAmountCents).toBe(150_000_00)
    expect(espejo!.despuesAmountCents).toBe(195_000_00)
    expect(segundo.resumen.tarifasEnConflicto).toBe(1)
  })
})

describe('identidad entre archivos', () => {
  it('los alias sembrados evitan duplicar a Ronny y compañía', () => {
    // Estado tras importar el CRM: los talentos ya existen con sus alias.
    const conocidos: TalentoConocido[] = ALIAS_SEMBRADOS.map((a, i) => ({
      talentId: `t${i}`,
      codigo: a.codigo,
      canonicalName: a.alias[0]!,
      displayName: a.alias[0]!,
      identificadores: a.alias.map(normalizeName),
    }))

    const plan = buildImportPlan(roster, 'ROSTER', {
      talentosConocidos: conocidos,
      tarifasActuales: [],
      archivo: 'Roster.xlsx',
      sha256: 'x',
    })

    // Los nombres del roster que difieren del CRM deben caer en el talento ya
    // existente, no crear uno nuevo.
    const casos = [
      ['Ronny (Ronaldo López)', 'KT-004'],
      ['Divino Espinosa', 'KT-001'],
      ['Mar Coronel', 'KT-008'],
      // El importador recorta: "Tony Gastelum " llega ya sin el espacio final.
      ['Tony Gastelum', 'KT-012'],
      ['Padigol)', 'KT-028'],
    ] as const

    for (const [nombreEnRoster, codigoEsperado] of casos) {
      const e = plan.talentos.find((t) => t.crudo === nombreEnRoster)
      expect(e, `no se encontró "${nombreEnRoster}" en el roster`).toBeDefined()
      const resuelto = e!.codigo ?? e!.identidad?.mejor?.codigo
      expect(resuelto, `${nombreEnRoster} → ${resuelto}`).toBe(codigoEsperado)
    }
  })

  it('Yoiker y Ronny nunca se proponen como el mismo talento', () => {
    const conocidos: TalentoConocido[] = [{
      talentId: 'ronny', codigo: 'KT-004', canonicalName: 'Ronny',
      displayName: 'Ronny', identificadores: ['ronny', 'ronaldo bxm'],
    }]
    const plan = buildImportPlan(roster, 'ROSTER', {
      talentosConocidos: conocidos, tarifasActuales: [], archivo: 'R.xlsx', sha256: 'x',
    })
    const yoiker = plan.talentos.find((t) => t.crudo === 'Yoiker')
    expect(yoiker).toBeDefined()
    expect(yoiker!.talentIdExistente).not.toBe('ronny')
    expect(yoiker!.identidad?.mejor?.talentId).not.toBe('ronny')
  })
})

describe('métricas del roster', () => {
  let plan: PlanImportacion

  beforeAll(() => {
    plan = buildImportPlan(roster, 'ROSTER', {
      talentosConocidos: [], tarifasActuales: [], archivo: 'R.xlsx', sha256: 'x',
    })
  })

  it('lee los conteos de seguidores de todos los talentos del roster', () => {
    const conMetricas = plan.talentos.filter((t) => t.metricas.length > 0)
    expect(conMetricas.length).toBeGreaterThanOrEqual(16)
    expect(plan.resumen.metricasNuevas).toBeGreaterThan(40)
  })

  it('marca para revisión los valores dudosos en vez de inventarlos', () => {
    const dudosas = plan.talentos.flatMap((t) =>
      t.metricas.filter((m) => m.requiereRevision),
    )
    // El archivo trae "99.1.K", "496.0" y algún 0.0: deben salir marcados.
    expect(dudosas.length).toBeGreaterThan(0)
    for (const m of dudosas) expect(m.notas.length).toBeGreaterThan(0)
  })

  it('ninguna métrica inventa un cero a partir de una celda ilegible', () => {
    const fallidas = plan.talentos.flatMap((t) =>
      t.metricas.filter((m) => m.confianza === 'FALLIDO'),
    )
    for (const m of fallidas) expect(m.seguidores).toBeNull()
  })
})

describe('talentos ausentes', () => {
  it('un talento que el archivo no trae se marca, nunca se borra', () => {
    const conocidos: TalentoConocido[] = [{
      talentId: 'fantasma', codigo: 'KT-999', canonicalName: 'Talento Que No Viene',
      displayName: 'Talento Que No Viene', identificadores: ['talento que no viene'],
    }]
    const plan = buildImportPlan(crm, 'CRM_COMERCIAL', {
      talentosConocidos: conocidos, tarifasActuales: [],
      archivo: 'CRM.xlsx', sha256: sha256(bufCrm),
    })
    expect(plan.ausentes).toHaveLength(1)
    expect(plan.ausentes[0]!.talentId).toBe('fantasma')
    const inc = plan.incidencias.find((i) => i.codigo === 'TALENTO_AUSENTE')
    expect(inc?.mensaje).toContain('no se borra nada')
  })
})

describe('detección del tipo de archivo', () => {
  it('el usuario puede subir cualquiera de los dos sin decir cuál es', () => {
    expect(detectarTipoArchivo(crm)).toBe('CRM_COMERCIAL')
    expect(detectarTipoArchivo(roster)).toBe('ROSTER')
  })
})
