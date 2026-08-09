import 'server-only'
import { prisma } from '@/lib/db'
import { append } from '@/server/audit/append'
import { leerAjustes } from '@/server/data/ajustes'
import { autorizar } from '@/server/data/autorizar'
import { formatMXN } from '@/lib/money'
import { claveCelda, tieneAjuste } from '@/lib/editor/tipos'
import type {
  EstadoEditor, CeldaEditor, EstadoCotizacion,
} from '@/lib/editor/tipos'
import type { EstadoPrecioDoc } from '@/lib/doc/tipos'
import type { Actor } from '@/lib/authz/policy'

/**
 * Lectura y escritura de la cotización que está sobre la mesa del editor.
 *
 * La regla que gobierna todo este archivo: el tarifario da el precio BASE y la
 * cotización guarda el AJUSTE aparte, nunca encima. Así se puede enseñar de
 * dónde salió cada cifra, revertir un ajuste sin volver a consultar el Excel, y
 * responder a "¿por qué le cobramos esto a HONOR?" meses después.
 */

/** Error de bloqueo optimista: alguien más guardó primero. */
export class ConflictoRevisionError extends Error {
  readonly revisionActual: number
  readonly quienNombre: string | null
  constructor(revisionActual: number, quienNombre: string | null) {
    super(
      quienNombre
        ? `${quienNombre} guardó cambios en esta cotización mientras la editabas.`
        : 'Alguien guardó cambios en esta cotización mientras la editabas.',
    )
    this.name = 'ConflictoRevisionError'
    this.revisionActual = revisionActual
    this.quienNombre = quienNombre
  }
}

const TITULO_CONSIDERACIONES = 'Consideraciones'
const TITULO_TERMINOS = 'Términos y Condiciones'
// Con punto: así está en el documento original de la agencia. Sin él, el
// oráculo de fidelidad marca la diferencia — y con razón, es lo que reciben
// las marcas desde hace tiempo.
const TITULO_CONFIDENCIALIDAD = 'Confidencialidad.'

// ─────────────────────────────── Lectura ───────────────────────────────

/**
 * El estado completo del editor.
 *
 * Sale de una sola consulta con sus relaciones: el editor necesita todo a la
 * vez y una cotización, aun con los 21 talentos y los 19 formatos, son 399
 * celdas — nada que justifique paginar.
 */
export async function leerEditor(quoteId: string): Promise<EstadoEditor | null> {
  const actor = await autorizar('cotizacion.ver', {
    entidadTipo: 'Quote',
    entidadId: quoteId,
  })

  const q = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      client: true,
      contact: true,
      agent: { select: { nombre: true } },
      createdBy: { select: { id: true, nombre: true } },
      talents: {
        orderBy: { sortOrder: 'asc' },
        include: { talent: { select: { displayName: true, canonicalName: true } } },
      },
      columns: {
        orderBy: { sortOrder: 'asc' },
        include: { deliverableType: { select: { pdfLabel: true, pdfSublabel: true } } },
      },
      prices: true,
      considerations: { orderBy: { sortOrder: 'asc' } },
      terms: { orderBy: { number: 'asc' } },
    },
  })
  if (!q) return null

  // `can` ya decidió con el rol; aquí se comprueba lo que depende de la fila,
  // que hasta ahora no se conocía.
  void actor

  const ajustes = await leerAjustes()

  const celdas: Record<string, CeldaEditor> = {}
  for (const p of q.prices) {
    celdas[claveCelda(p.quoteTalentId, p.deliverableTypeId)] = {
      id: p.id,
      quoteTalentId: p.quoteTalentId,
      deliverableTypeId: p.deliverableTypeId,
      baseAmountCents: p.baseAmountCents,
      basePriceStatus: p.basePriceStatus as EstadoPrecioDoc,
      overrideAmountCents: p.overrideAmountCents,
      overridePriceStatus: (p.overridePriceStatus as EstadoPrecioDoc | null) ?? null,
      overrideReason: p.overrideReason,
    }
  }

  return {
    quoteId: q.id,
    revision: q.revision,
    folio: q.folio,
    draftRef: q.draftRef,
    estado: q.status as EstadoCotizacion,
    titulo: 'Tabulador de Tarifas',
    cliente: q.client.displayName,
    contacto: q.contact?.name ?? null,
    agente: q.agent?.nombre ?? q.agentLabel ?? q.createdBy.nombre,
    moneda: q.currency,
    talentos: q.talents.map((t) => ({
      id: t.id,
      talentId: t.talentId,
      nombre: t.displayNameOverride ?? t.talent.displayName,
      nombreCanonico: t.talent.canonicalName,
      orden: t.sortOrder,
    })),
    columnas: q.columns.map((c) => ({
      deliverableTypeId: c.deliverableTypeId,
      label: c.headerLabel,
      sublabel: c.headerSublabel,
      orden: c.sortOrder,
    })),
    celdas,
    eyebrow: ajustes.eyebrow,
    tituloConsideraciones: TITULO_CONSIDERACIONES,
    // Se copiaron a la cotización al crearla; si alguna se quedó vacía se cae
    // a la plantilla, nunca a una lista vacía.
    consideraciones: q.considerations.length
      ? q.considerations.map((c) => c.text)
      : ajustes.consideraciones,
    tituloTerminos: TITULO_TERMINOS,
    terminos: q.terms.length ? q.terms.map((t) => t.body) : ajustes.terminos,
    confidencialidadTitulo: TITULO_CONFIDENCIALIDAD,
    confidencialidadTexto: ajustes.confidencialidadTexto,
    firma: ajustes.firmaTexto,
    piePagina: ajustes.pieTexto,
    textoPendiente: 'Cotizar',
    textoCasoPorCaso: 'Cotizar',
    textoNoAplica: 'No aplica',
    textoVacio: '—',
    preciosEnMorado: ajustes.preciosEnMorado,
  }
}

/**
 * Deja constancia de que alguien se llevó el PDF.
 *
 * Es el momento en que el documento sale de la agencia, así que es justo lo que
 * hay que poder rastrear: si una marca enseña un tabulador con cifras raras, la
 * bitácora dice quién lo descargó y cuándo.
 */
export async function registrarDescarga(
  quoteId: string,
  archivo: string,
  paginas: number,
): Promise<void> {
  const actor = await autorizar('cotizacion.descargarPdf', {
    entidadTipo: 'Quote',
    entidadId: quoteId,
  })
  const q = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { folio: true, draftRef: true, client: { select: { displayName: true } } },
  })
  if (!q) return

  await prisma.$transaction(async (tx) => {
    await append(tx, {
      actor,
      categoria: 'DOCUMENTO',
      accion: 'pdf.descargado',
      entidadTipo: 'Quote',
      entidadId: quoteId,
      entidadEtiqueta: q.folio ?? q.draftRef,
      resumen: `${actor.nombre} descargó el PDF de ${q.client.displayName} (${paginas} página(s)).`,
      metadatos: { archivo, paginas },
      // Descargarlo tres veces seguidas mientras se prepara el correo es un
      // solo hecho, no tres.
      coalescerPor: `descarga|${quoteId}`,
    })
  })
}

/** Lista para la pantalla de cotizaciones. */
export async function listarCotizaciones(limite = 50) {
  await autorizar('cotizacion.ver')
  return prisma.quote.findMany({
    take: limite,
    orderBy: { actualizadoEn: 'desc' },
    select: {
      id: true, folio: true, draftRef: true, status: true,
      projectName: true, actualizadoEn: true, totalCents: true,
      client: { select: { displayName: true } },
      createdBy: { select: { nombre: true } },
      includeCotizacion: true,
      _count: { select: { talents: true, columns: true, lines: true } },
    },
  })
}

// ─────────────────────────────── Creación ──────────────────────────────

export interface NuevaCotizacion {
  clienteNombre: string
  contactoNombre?: string
  /** Talent.id, en el orden en que se imprimirán. */
  talentIds: string[]
  /** DeliverableType.id, en el orden de las columnas. */
  formatoIds: string[]
  proyecto?: string
}

/**
 * Arma una cotización nueva copiando el tarifario del momento.
 *
 * La copia es deliberada: si el tarifario sube la semana que viene, esta
 * cotización sigue diciendo lo que decía cuando se armó, y la diferencia entre
 * el base copiado y el ajuste es lo que explica cada cifra ante la marca.
 *
 * El folio NO se acuña aquí. Un borrador que nadie envía no debe quemar un
 * consecutivo; se reserva al emitir.
 */
export async function crearCotizacion(entrada: NuevaCotizacion): Promise<string> {
  const actor = await autorizar('cotizacion.crear')

  const nombre = entrada.clienteNombre.trim()
  if (!nombre) throw new Error('Escribe el nombre del cliente.')
  if (entrada.talentIds.length === 0) throw new Error('Elige al menos un talento.')
  if (entrada.formatoIds.length === 0) throw new Error('Elige al menos un formato.')

  const ajustes = await leerAjustes()

  const [talentos, formatos, tarifas] = await Promise.all([
    prisma.talent.findMany({
      where: { id: { in: entrada.talentIds } },
      select: { id: true, displayName: true },
    }),
    prisma.deliverableType.findMany({
      where: { id: { in: entrada.formatoIds } },
      select: { id: true, pdfLabel: true, pdfSublabel: true },
    }),
    prisma.talentRate.findMany({
      where: {
        talentId: { in: entrada.talentIds },
        deliverableTypeId: { in: entrada.formatoIds },
      },
      select: {
        talentId: true, deliverableTypeId: true,
        amountCents: true, priceStatus: true,
      },
    }),
  ])

  const porTalento = new Map(talentos.map((t) => [t.id, t]))
  const porFormato = new Map(formatos.map((f) => [f.id, f]))
  const porTarifa = new Map(
    tarifas.map((r) => [`${r.talentId}|${r.deliverableTypeId}`, r]),
  )

  const cliente = await asegurarCliente(nombre)
  const contacto = entrada.contactoNombre?.trim()
    ? await asegurarContacto(cliente.id, entrada.contactoNombre.trim())
    : null

  return prisma.$transaction(async (tx) => {
    const quote = await tx.quote.create({
      data: {
        draftRef: `BORRADOR-${refAleatoria()}`,
        clientId: cliente.id,
        contactId: contacto?.id ?? null,
        createdById: actor.id,
        projectName: entrada.proyecto?.trim() || null,
        currency: ajustes.monedaDefault,
        taxRateBps: ajustes.ivaBps,
        validityLabel: ajustes.vigenciaDefault,
        includeTabulador: true,
        actualizadoPorNombre: actor.nombre,
        considerations: {
          create: ajustes.consideraciones.map((text, i) => ({ text, sortOrder: i })),
        },
        terms: {
          create: ajustes.terminos.map((body, i) => ({
            number: i + 1, body, sortOrder: i,
          })),
        },
        columns: {
          create: entrada.formatoIds.flatMap((id, i) => {
            const f = porFormato.get(id)
            return f
              ? [{
                  deliverableTypeId: id,
                  headerLabel: f.pdfLabel,
                  headerSublabel: f.pdfSublabel,
                  sortOrder: i,
                }]
              : []
          }),
        },
      },
      select: { id: true },
    })

    // Los talentos primero: sus ids hacen falta para las celdas.
    const quoteTalents = new Map<string, string>()
    for (const [i, talentId] of entrada.talentIds.entries()) {
      if (!porTalento.has(talentId)) continue
      const qt = await tx.quoteTalent.create({
        data: { quoteId: quote.id, talentId, sortOrder: i },
        select: { id: true },
      })
      quoteTalents.set(talentId, qt.id)
    }

    // Una celda por cruce, incluidas las que el tarifario no tiene: una casilla
    // vacía en la matriz es información —"no lo hemos tarifado"—, y sin la fila
    // no habría dónde escribir el ajuste.
    const celdas = []
    for (const [i, talentId] of entrada.talentIds.entries()) {
      const quoteTalentId = quoteTalents.get(talentId)
      if (!quoteTalentId) continue
      for (const [j, deliverableTypeId] of entrada.formatoIds.entries()) {
        if (!porFormato.has(deliverableTypeId)) continue
        const r = porTarifa.get(`${talentId}|${deliverableTypeId}`)
        celdas.push({
          quoteId: quote.id,
          quoteTalentId,
          deliverableTypeId,
          baseAmountCents: r?.amountCents ?? null,
          basePriceStatus: r?.priceStatus ?? 'PENDING',
          sortOrder: i * 100 + j,
        })
      }
    }
    if (celdas.length) await tx.quotePrice.createMany({ data: celdas })

    await append(tx, {
      actor,
      categoria: 'COTIZACION',
      accion: 'cotizacion.creada',
      entidadTipo: 'Quote',
      entidadId: quote.id,
      entidadEtiqueta: cliente.displayName,
      resumen:
        `${actor.nombre} creó una cotización para ${cliente.displayName} ` +
        `con ${quoteTalents.size} talento(s) y ${entrada.formatoIds.length} formato(s).`,
    })

    return quote.id
  })
}

/** Sufijo legible del borrador: se dicta por teléfono sin confundirse. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sin I, O, 0, 1

function refAleatoria(): string {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('')
}

async function asegurarCliente(displayName: string) {
  const normalizedKey = displayName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()

  const existente = await prisma.client.findUnique({ where: { normalizedKey } })
  if (existente) return existente

  // El código del folio se sugiere y queda editable: los reales no son
  // derivables (Netflix es NFX, Viajes Lili es VDS).
  const ocupados = new Set(
    (await prisma.client.findMany({ select: { folioCode: true } })).map(
      (c) => c.folioCode,
    ),
  )
  const { sugerirFolioCode } = await import('@/server/quote/folio')
  return prisma.client.create({
    data: {
      displayName,
      normalizedKey,
      folioCode: sugerirFolioCode(displayName, ocupados),
    },
  })
}

async function asegurarContacto(clientId: string, name: string) {
  const existente = await prisma.clientContact.findFirst({ where: { clientId, name } })
  if (existente) return existente
  return prisma.clientContact.create({ data: { clientId, name } })
}

// ─────────────────────────────── Escritura ─────────────────────────────

export interface GuardarPrecioEntrada {
  quoteId: string
  quotePriceId: string
  /** La revisión que el editor creía tener. */
  revision: number
  /** `null` en ambos = se quita el ajuste y vuelve a mandar el tarifario. */
  amountCents: number | null
  status: EstadoPrecioDoc | null
  motivo?: string
}

export interface GuardarPrecioResultado {
  revision: number
  celda: CeldaEditor
}

/**
 * Ajusta —o revierte— el precio de una celda.
 *
 * Nunca toca `TalentRate`: lo que cambia es el ajuste de ESTA cotización. El
 * tarifario maestro se modifica desde su propia pantalla, a propósito, porque
 * bajarle el precio a un talento para un cliente no debe bajárselo para todos.
 */
export async function guardarPrecio(
  entrada: GuardarPrecioEntrada,
): Promise<GuardarPrecioResultado> {
  const previo = await prisma.quote.findUnique({
    where: { id: entrada.quoteId },
    select: { status: true, createdById: true, revision: true, actualizadoPorNombre: true },
  })
  if (!previo) throw new Error('La cotización ya no existe.')

  const actor = await autorizar('cotizacion.editar', {
    entidadTipo: 'Quote',
    entidadId: entrada.quoteId,
    recurso: { creadoPorId: previo.createdById, estado: previo.status },
  })

  return prisma.$transaction(async (tx) => {
    // El bloqueo optimista va en el mismo UPDATE que incrementa la revisión:
    // si otra pestaña guardó primero, el WHERE no encuentra nada y aquí se
    // sabe, en vez de pisar su cambio en silencio.
    const bloqueo = await tx.quote.updateMany({
      where: { id: entrada.quoteId, revision: entrada.revision },
      data: { revision: { increment: 1 }, actualizadoPorNombre: actor.nombre },
    })
    if (bloqueo.count === 0) {
      throw new ConflictoRevisionError(previo.revision, previo.actualizadoPorNombre)
    }

    const antes = await tx.quotePrice.findUnique({
      where: { id: entrada.quotePriceId },
      include: {
        quoteTalent: { select: { displayNameOverride: true, talent: { select: { displayName: true } } } },
        deliverableType: { select: { name: true } },
      },
    })
    if (!antes || antes.quoteId !== entrada.quoteId) {
      throw new Error('Esa celda no pertenece a esta cotización.')
    }

    const quitandoAjuste = entrada.status === null
    const despues = await tx.quotePrice.update({
      where: { id: entrada.quotePriceId },
      data: quitandoAjuste
        ? {
            overrideAmountCents: null,
            overridePriceStatus: null,
            overrideReason: null,
            overriddenById: null,
            overriddenAt: null,
          }
        : {
            overrideAmountCents: entrada.status === 'QUOTED' ? entrada.amountCents : null,
            overridePriceStatus: entrada.status,
            overrideReason: entrada.motivo ?? null,
            overriddenById: actor.id,
            overriddenAt: new Date(),
          },
    })

    const talento =
      antes.quoteTalent.displayNameOverride ?? antes.quoteTalent.talent.displayName
    const formato = antes.deliverableType.name

    const celda: CeldaEditor = {
      id: despues.id,
      quoteTalentId: despues.quoteTalentId,
      deliverableTypeId: despues.deliverableTypeId,
      baseAmountCents: despues.baseAmountCents,
      basePriceStatus: despues.basePriceStatus as EstadoPrecioDoc,
      overrideAmountCents: despues.overrideAmountCents,
      overridePriceStatus: (despues.overridePriceStatus as EstadoPrecioDoc | null) ?? null,
      overrideReason: despues.overrideReason,
    }

    const textoAntes = describirPrecio(
      antes.overridePriceStatus ?? antes.basePriceStatus,
      antes.overridePriceStatus ? antes.overrideAmountCents : antes.baseAmountCents,
    )
    const textoDespues = describirPrecio(
      despues.overridePriceStatus ?? despues.basePriceStatus,
      despues.overridePriceStatus ? despues.overrideAmountCents : despues.baseAmountCents,
    )

    await append(tx, {
      actor,
      categoria: 'COTIZACION',
      accion: quitandoAjuste ? 'precio.ajuste_revertido' : 'precio.ajustado',
      entidadTipo: 'QuotePrice',
      entidadId: despues.id,
      entidadEtiqueta: `${talento} · ${formato}`,
      resumen: quitandoAjuste
        ? `${actor.nombre} quitó el ajuste de ${talento} · ${formato}: vuelve al tarifario (${textoDespues})`
        : `${actor.nombre} ajustó ${talento} · ${formato} de ${textoAntes} a ${textoDespues}`,
      cambios: { precio: { antes: textoAntes, despues: textoDespues } },
      // Mientras alguien teclea un precio cada pulsación produciría un apunte.
      // Se agrupan los de la misma celda dentro de cinco minutos.
      coalescerPor: `precio|${despues.id}`,
    })

    return { revision: entrada.revision + 1, celda }
  })
}

function describirPrecio(status: string, cents: number | null): string {
  switch (status) {
    case 'QUOTED':
      return cents === null ? '—' : formatMXN(cents)
    case 'PENDING':
      return 'Pendiente'
    case 'CASE_BY_CASE':
      return 'Caso por caso'
    case 'NOT_APPLICABLE':
      return 'No aplica'
    default:
      return '—'
  }
}

/** Cambia el nombre impreso de un talento sin tocar su ficha. */
export async function renombrarTalento(
  quoteId: string,
  quoteTalentId: string,
  nombre: string,
  revision: number,
): Promise<{ revision: number; nombre: string }> {
  const previo = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { status: true, createdById: true, revision: true, actualizadoPorNombre: true },
  })
  if (!previo) throw new Error('La cotización ya no existe.')

  const actor = await autorizar('cotizacion.editar', {
    entidadTipo: 'Quote',
    entidadId: quoteId,
    recurso: { creadoPorId: previo.createdById, estado: previo.status },
  })

  const limpio = nombre.trim()
  if (!limpio) throw new Error('El nombre no puede quedar vacío.')

  return prisma.$transaction(async (tx) => {
    const bloqueo = await tx.quote.updateMany({
      where: { id: quoteId, revision },
      data: { revision: { increment: 1 }, actualizadoPorNombre: actor.nombre },
    })
    if (bloqueo.count === 0) {
      throw new ConflictoRevisionError(previo.revision, previo.actualizadoPorNombre)
    }

    const antes = await tx.quoteTalent.findUnique({
      where: { id: quoteTalentId },
      include: { talent: { select: { displayName: true } } },
    })
    if (!antes || antes.quoteId !== quoteId) {
      throw new Error('Ese talento no pertenece a esta cotización.')
    }
    const nombreAntes = antes.displayNameOverride ?? antes.talent.displayName

    await tx.quoteTalent.update({
      where: { id: quoteTalentId },
      // Volver al nombre de la ficha se guarda como "sin override", no como una
      // copia: si mañana cambia la ficha, el documento la sigue.
      data: { displayNameOverride: limpio === antes.talent.displayName ? null : limpio },
    })

    await append(tx, {
      actor,
      categoria: 'COTIZACION',
      accion: 'talento.nombre_documento',
      entidadTipo: 'QuoteTalent',
      entidadId: quoteTalentId,
      entidadEtiqueta: limpio,
      resumen: `${actor.nombre} cambió el nombre impreso de "${nombreAntes}" a "${limpio}"`,
      cambios: { nombre: { antes: nombreAntes, despues: limpio } },
      coalescerPor: `nombre|${quoteTalentId}`,
    })

    return { revision: revision + 1, nombre: limpio }
  })
}

/**
 * Cuánto se apartó la cotización del tarifario.
 *
 * Es lo que decide si hace falta aprobación: un ajuste del 23 % sobre un
 * talento no es lo mismo que redondear mil pesos.
 */
export function medirAjustes(estado: EstadoEditor): {
  ajustadas: number
  totales: number
  maxDescuentoBps: number
} {
  let ajustadas = 0
  let maxDescuentoBps = 0
  const celdas = Object.values(estado.celdas)

  for (const c of celdas) {
    if (!tieneAjuste(c)) continue
    ajustadas++
    if (
      c.basePriceStatus === 'QUOTED' &&
      c.overridePriceStatus === 'QUOTED' &&
      c.baseAmountCents &&
      c.overrideAmountCents !== null &&
      c.overrideAmountCents < c.baseAmountCents
    ) {
      const bps = Math.round(
        ((c.baseAmountCents - c.overrideAmountCents) / c.baseAmountCents) * 10_000,
      )
      if (bps > maxDescuentoBps) maxDescuentoBps = bps
    }
  }
  return { ajustadas, totales: celdas.length, maxDescuentoBps }
}

export type { Actor }
