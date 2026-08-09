import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { append } from '@/server/audit/append'
import { leerAjustes } from '@/server/data/ajustes'
import { autorizar } from '@/server/data/autorizar'
import { formatMXN } from '@/lib/money'
import { computeQuote } from '@/server/pricing/compute'
import { ConflictoRevisionError } from '@/server/data/cotizacion'
import type { EstadoPrecioDoc } from '@/lib/doc/tipos'
import type { EstadoCotizacion } from '@/lib/editor/tipos'
import type { EstadoHoja, RenglonHoja, TalentoHoja, AccionTalento } from '@/lib/hoja/tipos'
import type { Actor } from '@/lib/authz/policy'

/**
 * La hoja de cotización: crear, leer y mover renglones.
 *
 * Vive aparte de `cotizacion.ts` a propósito. Aquel archivo gobierna el
 * tabulador —la matriz talento × formato cuyo PDF está verificado contra el
 * documento real de HONOR— y no se toca. Éste gobierna la cotización por
 * renglones, que es un camino distinto sobre el MISMO modelo de datos.
 *
 * Las dos reglas que no se negocian, heredadas del tabulador:
 *
 *   1. El tarifario da el precio base y la cotización guarda el suyo aparte.
 *      Editar aquí NUNCA escribe en `TalentRate`.
 *   2. Toda mutación pasa por el bloqueo optimista de `Quote.revision`, en el
 *      mismo UPDATE que lo incrementa.
 */

/** Sufijo legible del borrador: se dicta por teléfono sin confundirse. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sin I, O, 0, 1

function refAleatoria(): string {
  const bytes = new Uint8Array(4)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('')
}

/**
 * Nombre del cliente mientras nadie lo ha escrito.
 *
 * El borrador nace sin cliente porque el encargo pide entrar a cotizar sin
 * pasar por un formulario. `Client` es obligatorio en el esquema, así que se
 * usa un registro por cotización que se reemplaza en cuanto se teclea el
 * nombre real.
 */
const CLIENTE_SIN_DEFINIR = 'Sin cliente'

// ─────────────────────────────── Creación ──────────────────────────────

/**
 * Crea un borrador vacío y devuelve su id.
 *
 * No pide cliente, ni talentos, ni formatos: el usuario entra directo a la
 * hoja y la va llenando. Tampoco acuña folio — un borrador que nadie envía no
 * debe quemar un consecutivo.
 */
export async function crearBorradorVacio(): Promise<string> {
  const actor = await autorizar('cotizacion.crear')
  const ajustes = await leerAjustes()

  const cliente = await asegurarClienteSinDefinir()

  return prisma.$transaction(async (tx) => {
    const quote = await tx.quote.create({
      data: {
        draftRef: `BORRADOR-${refAleatoria()}`,
        clientId: cliente.id,
        createdById: actor.id,
        currency: ajustes.monedaDefault,
        taxRateBps: ajustes.ivaBps,
        validityLabel: ajustes.vigenciaDefault,
        // Este es el camino de renglones, no el del tabulador.
        includeTabulador: false,
        includeCotizacion: true,
        actualizadoPorNombre: actor.nombre,
        considerations: {
          create: ajustes.consideraciones.map((text, i) => ({ text, sortOrder: i })),
        },
        terms: {
          create: ajustes.terminos.map((body, i) => ({
            number: i + 1, body, sortOrder: i,
          })),
        },
      },
      select: { id: true, draftRef: true },
    })

    await append(tx, {
      actor,
      categoria: 'COTIZACION',
      accion: 'cotizacion.creada',
      entidadTipo: 'Quote',
      entidadId: quote.id,
      entidadEtiqueta: quote.draftRef,
      resumen: `${actor.nombre} abrió una cotización nueva (${quote.draftRef}).`,
    })

    return quote.id
  })
}

async function asegurarClienteSinDefinir() {
  const normalizedKey = 'SIN CLIENTE'
  const existente = await prisma.client.findUnique({ where: { normalizedKey } })
  if (existente) return existente
  return prisma.client.create({
    data: { displayName: CLIENTE_SIN_DEFINIR, normalizedKey, folioCode: 'XXX' },
  })
}

// ─────────────────────────────── Lectura ───────────────────────────────

/**
 * En qué superficie se abre esta cotización.
 *
 * Las creadas con el flujo nuevo son hojas de renglones; las anteriores, y las
 * que se arman como tabulador comparativo, siguen abriéndose en el editor de
 * matriz. `null` si no existe.
 */
export async function modoDeCotizacion(
  quoteId: string,
): Promise<'HOJA' | 'TABULADOR' | null> {
  await autorizar('cotizacion.ver', { entidadTipo: 'Quote', entidadId: quoteId })
  const q = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { includeCotizacion: true },
  })
  if (!q) return null
  return q.includeCotizacion ? 'HOJA' : 'TABULADOR'
}

/**
 * El estado completo de la hoja en una sola consulta.
 *
 * Incluye las acciones disponibles por talento, que salen del tarifario real:
 * sin ellas la interfaz tendría que adivinar qué se le puede vender a cada
 * quien, y el encargo es explícito en que no se inventan tarifas.
 */
export async function leerHoja(quoteId: string): Promise<EstadoHoja | null> {
  await autorizar('cotizacion.ver', { entidadTipo: 'Quote', entidadId: quoteId })

  const q = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      client: true,
      contact: true,
      talents: {
        orderBy: { sortOrder: 'asc' },
        include: {
          talent: { select: { displayName: true, category: true, slug: true } },
        },
      },
      lines: {
        orderBy: { sortOrder: 'asc' },
        include: {
          quotePrice: {
            select: { baseAmountCents: true, basePriceStatus: true },
          },
          deliverableType: { select: { allowsQuantity: true } },
        },
      },
    },
  })
  if (!q) return null

  const acciones = await accionesPorTalento(q.talents.map((t) => t.talentId))

  const renglonesPorTalento = new Map<string, RenglonHoja[]>()
  for (const l of q.lines) {
    if (!l.quoteTalentId) continue
    const lista = renglonesPorTalento.get(l.quoteTalentId) ?? []
    lista.push({
      id: l.id,
      quoteTalentId: l.quoteTalentId,
      deliverableTypeId: l.deliverableTypeId,
      concepto: l.description,
      detalle: l.detail,
      cantidad: l.quantity,
      unitAmountCents: l.unitAmountCents,
      priceStatus: l.priceStatus as EstadoPrecioDoc,
      permiteCantidad: l.deliverableType?.allowsQuantity ?? true,
      baseAmountCents: l.quotePrice?.baseAmountCents ?? null,
      basePriceStatus: (l.quotePrice?.basePriceStatus as EstadoPrecioDoc | null) ?? null,
      orden: l.sortOrder,
    })
    renglonesPorTalento.set(l.quoteTalentId, lista)
  }

  const talentos: TalentoHoja[] = q.talents.map((t) => ({
    id: t.id,
    talentId: t.talentId,
    slug: t.talent.slug,
    nombre: t.displayNameOverride ?? t.talent.displayName,
    categoria: t.talent.category,
    orden: t.sortOrder,
    renglones: renglonesPorTalento.get(t.id) ?? [],
    acciones: acciones.get(t.talentId) ?? [],
  }))

  return {
    quoteId: q.id,
    revision: q.revision,
    folio: q.folio,
    draftRef: q.draftRef,
    estado: q.status as EstadoCotizacion,
    // El placeholder no se le enseña al usuario: el encabezado sale vacío y con
    // su marca de agua, que es lo que invita a escribirlo.
    cliente: q.client.displayName === CLIENTE_SIN_DEFINIR ? '' : q.client.displayName,
    contacto: q.contact?.name ?? null,
    proyecto: q.projectName,
    moneda: q.currency,
    ivaBps: q.taxRateBps,
    talentos,
  }
}

/**
 * Qué se le puede vender a cada talento, según el tarifario.
 *
 * Se excluye lo marcado "No aplica": si el talento no ofrece ese formato, no
 * tiene por qué aparecer como botón. El orden es el del catálogo de la
 * agencia, que ya está ordenado por lo que más se vende.
 */
async function accionesPorTalento(
  talentIds: string[],
): Promise<Map<string, AccionTalento[]>> {
  const fuera = new Map<string, AccionTalento[]>()
  if (talentIds.length === 0) return fuera

  const tarifas = await prisma.talentRate.findMany({
    where: {
      talentId: { in: talentIds },
      priceStatus: { not: 'NOT_APPLICABLE' },
      deliverableType: { isActive: true },
    },
    orderBy: { deliverableType: { sortOrder: 'asc' } },
    select: {
      talentId: true,
      deliverableTypeId: true,
      amountCents: true,
      priceStatus: true,
      deliverableType: {
        select: { name: true, unitLabel: true, allowsQuantity: true },
      },
    },
  })

  for (const r of tarifas) {
    const lista = fuera.get(r.talentId) ?? []
    lista.push({
      deliverableTypeId: r.deliverableTypeId,
      nombre: r.deliverableType.name,
      unitLabel: r.deliverableType.unitLabel,
      permiteCantidad: r.deliverableType.allowsQuantity,
      amountCents: r.amountCents,
      priceStatus: r.priceStatus as EstadoPrecioDoc,
    })
    fuera.set(r.talentId, lista)
  }
  return fuera
}

// ─────────────────────────────── Escritura ─────────────────────────────

/**
 * Abre una mutación: autoriza, toma el bloqueo optimista y entrega el actor.
 *
 * Todas las escrituras de la hoja pasan por aquí. Repetir este preámbulo en
 * cada una es justo como se cuela una que se olvida de comprobar la revisión y
 * pisa el cambio de otra pestaña en silencio.
 */
async function conBloqueo<T>(
  quoteId: string,
  revision: number,
  trabajo: (tx: Prisma.TransactionClient, actor: Actor) => Promise<T>,
): Promise<{ revision: number; resultado: T }> {
  const previo = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      status: true, createdById: true, revision: true, actualizadoPorNombre: true,
    },
  })
  if (!previo) throw new Error('La cotización ya no existe.')

  const actor = await autorizar('cotizacion.editar', {
    entidadTipo: 'Quote',
    entidadId: quoteId,
    recurso: { creadoPorId: previo.createdById, estado: previo.status },
  })

  return prisma.$transaction(async (tx) => {
    const bloqueo = await tx.quote.updateMany({
      where: { id: quoteId, revision },
      data: { revision: { increment: 1 }, actualizadoPorNombre: actor.nombre },
    })
    if (bloqueo.count === 0) {
      throw new ConflictoRevisionError(previo.revision, previo.actualizadoPorNombre)
    }

    const resultado = await trabajo(tx, actor)
    await recalcularTotales(tx, quoteId)
    return { revision: revision + 1, resultado }
  })
}

/**
 * Recalcula y guarda el caché de totales de la cotización.
 *
 * `computeQuote` es la verdad; estas columnas son para que la lista de
 * cotizaciones pueda enseñar un importe sin recalcular veintitantas. Hasta
 * ahora nadie las escribía, y por eso la lista mostraba $0 en todo.
 */
async function recalcularTotales(
  tx: Prisma.TransactionClient,
  quoteId: string,
): Promise<void> {
  const q = await tx.quote.findUnique({
    where: { id: quoteId },
    select: {
      taxRateBps: true,
      talents: { select: { id: true } },
      lines: {
        select: {
          id: true, quoteTalentId: true, quantity: true,
          unitAmountCents: true, priceStatus: true, isBillable: true,
        },
      },
    },
  })
  if (!q) return

  const calculo = computeQuote({
    talents: q.talents.map((t) => ({ id: t.id, displayName: '' })),
    lines: q.lines.map((l) => ({
      id: l.id,
      quoteTalentId: l.quoteTalentId,
      quantity: l.quantity,
      unitAmountCents: l.unitAmountCents,
      priceStatus: l.priceStatus as EstadoPrecioDoc,
      isBillable: l.isBillable,
    })),
    taxMode: 'ADDED',
    taxRateBps: q.taxRateBps,
  })

  await tx.quote.update({
    where: { id: quoteId },
    data: {
      subtotalCents: calculo.subtotalCents,
      lineDiscountCents: calculo.lineDiscountCents,
      packageDiscountCents: calculo.packageDiscountCents,
      taxableBaseCents: calculo.taxableBaseCents,
      taxCents: calculo.taxCents,
      totalCents: calculo.totalCents,
      hasNonQuotedLines: calculo.hasNonQuotedLines,
      computedAt: new Date(),
    },
  })

  // Los netos por talento alimentan los subtotales del PDF de cotización.
  for (const t of calculo.talents) {
    await tx.quoteTalent.update({
      where: { id: t.id },
      data: {
        grossCents: t.grossCents,
        lineDiscountCents: t.lineDiscountCents,
        allocatedPackageDiscountCents: t.allocatedPackageDiscountCents,
        netCents: t.netCents,
      },
    })
  }
}

/**
 * Mete un talento a la cotización. Idempotente: dos taps no lo duplican.
 *
 * Devuelve el bloque ya armado —con sus acciones disponibles— para que la
 * interfaz lo pinte sin una segunda vuelta al servidor. Un tap tiene que verse
 * inmediato; esperar dos viajes de red para dibujar la tarjeta lo delata.
 */
export async function agregarTalento(
  quoteId: string,
  talentId: string,
  revision: number,
): Promise<{ revision: number; talento: TalentoHoja }> {
  const { revision: nueva, resultado } = await conBloqueo(
    quoteId,
    revision,
    async (tx, actor) => {
      const talento = await tx.talent.findUnique({
        where: { id: talentId },
        select: {
          displayName: true, category: true, slug: true,
          roster: true, isActive: true,
        },
      })
      if (!talento) throw new Error('Ese talento no existe.')
      if (!talento.isActive || talento.roster !== 'KATANA') {
        throw new Error(`${talento.displayName} no está en el roster de Katana.`)
      }

      const existente = await tx.quoteTalent.findUnique({
        where: { quoteId_talentId: { quoteId, talentId } },
        select: { id: true, sortOrder: true, displayNameOverride: true },
      })

      const qt =
        existente ??
        (await tx.quoteTalent.create({
          data: {
            quoteId,
            talentId,
            sortOrder:
              ((
                await tx.quoteTalent.aggregate({
                  where: { quoteId },
                  _max: { sortOrder: true },
                })
              )._max.sortOrder ?? -1) + 1,
          },
          select: { id: true, sortOrder: true, displayNameOverride: true },
        }))

      if (!existente) {
        await append(tx, {
          actor,
          categoria: 'COTIZACION',
          accion: 'cotizacion.talento_agregado',
          entidadTipo: 'Quote',
          entidadId: quoteId,
          entidadEtiqueta: talento.displayName,
          resumen: `${actor.nombre} agregó a ${talento.displayName} a la cotización.`,
        })
      }

      return {
        id: qt.id,
        talentId,
        slug: talento.slug,
        nombre: qt.displayNameOverride ?? talento.displayName,
        categoria: talento.category,
        orden: qt.sortOrder,
        renglones: [],
        acciones: [],
      } satisfies TalentoHoja
    },
  )

  // Las acciones salen del tarifario, fuera de la transacción: no participan
  // del bloqueo y consultarlas dentro sólo alargaría la escritura.
  const acciones = await accionesPorTalento([talentId])
  return {
    revision: nueva,
    talento: { ...resultado, acciones: acciones.get(talentId) ?? [] },
  }
}

/** Saca un talento y todos sus renglones. */
export async function quitarTalento(
  quoteId: string,
  quoteTalentId: string,
  revision: number,
): Promise<{ revision: number }> {
  const { revision: nueva } = await conBloqueo(quoteId, revision, async (tx, actor) => {
    const qt = await tx.quoteTalent.findUnique({
      where: { id: quoteTalentId },
      select: { quoteId: true, talent: { select: { displayName: true } } },
    })
    if (!qt || qt.quoteId !== quoteId) {
      throw new Error('Ese talento no pertenece a esta cotización.')
    }
    // Las líneas caen con él por la cascada declarada en el esquema.
    await tx.quoteTalent.delete({ where: { id: quoteTalentId } })

    await append(tx, {
      actor,
      categoria: 'COTIZACION',
      accion: 'cotizacion.talento_quitado',
      entidadTipo: 'Quote',
      entidadId: quoteId,
      entidadEtiqueta: qt.talent.displayName,
      resumen: `${actor.nombre} quitó a ${qt.talent.displayName} de la cotización.`,
    })
  })
  return { revision: nueva }
}

export interface RenglonNuevo {
  quoteId: string
  quoteTalentId: string
  deliverableTypeId: string
  revision: number
}

/**
 * Agrega un entregable y le trae su precio del tarifario en el acto (§17).
 *
 * Guarda además una foto de la tarifa del momento en `QuotePrice`. Esa foto es
 * la que después permite decir "CRM $70,000" debajo de un precio negociado sin
 * volver a consultar el tarifario, que para entonces pudo cambiar.
 */
export async function agregarRenglon(
  e: RenglonNuevo,
): Promise<{ revision: number; renglon: RenglonHoja }> {
  const { revision, resultado } = await conBloqueo(e.quoteId, e.revision, async (tx, actor) => {
    const qt = await tx.quoteTalent.findUnique({
      where: { id: e.quoteTalentId },
      select: { quoteId: true, talentId: true, talent: { select: { displayName: true } } },
    })
    if (!qt || qt.quoteId !== e.quoteId) {
      throw new Error('Ese talento no pertenece a esta cotización.')
    }

    const formato = await tx.deliverableType.findUnique({
      where: { id: e.deliverableTypeId },
      select: { name: true, unitLabel: true, allowsQuantity: true },
    })
    if (!formato) throw new Error('Ese formato no existe.')

    const tarifa = await tx.talentRate.findUnique({
      where: {
        talentId_deliverableTypeId: {
          talentId: qt.talentId,
          deliverableTypeId: e.deliverableTypeId,
        },
      },
      select: { amountCents: true, priceStatus: true },
    })

    // La foto del tarifario. Una por talento × formato: si se agregan dos
    // renglones del mismo entregable comparten la misma referencia, que es lo
    // correcto — la tarifa base es una sola.
    const precio = await tx.quotePrice.upsert({
      where: {
        quoteId_quoteTalentId_deliverableTypeId: {
          quoteId: e.quoteId,
          quoteTalentId: e.quoteTalentId,
          deliverableTypeId: e.deliverableTypeId,
        },
      },
      update: {},
      create: {
        quoteId: e.quoteId,
        quoteTalentId: e.quoteTalentId,
        deliverableTypeId: e.deliverableTypeId,
        baseAmountCents: tarifa?.amountCents ?? null,
        basePriceStatus: tarifa?.priceStatus ?? 'PENDING',
        showInTabulador: false,
      },
      select: { id: true, baseAmountCents: true, basePriceStatus: true },
    })

    const ultimo = await tx.quoteLine.aggregate({
      where: { quoteId: e.quoteId },
      _max: { sortOrder: true },
    })

    const linea = await tx.quoteLine.create({
      data: {
        quoteId: e.quoteId,
        quoteTalentId: e.quoteTalentId,
        quotePriceId: precio.id,
        deliverableTypeId: e.deliverableTypeId,
        description: formato.name,
        quantity: 1,
        // El renglón nace con la tarifa del tarifario, tal cual, sin ajuste.
        unitAmountCents: precio.baseAmountCents,
        priceStatus: precio.basePriceStatus,
        sortOrder: (ultimo._max.sortOrder ?? -1) + 1,
      },
    })

    await append(tx, {
      actor,
      categoria: 'COTIZACION',
      accion: 'cotizacion.renglon_agregado',
      entidadTipo: 'Quote',
      entidadId: e.quoteId,
      entidadEtiqueta: `${qt.talent.displayName} · ${formato.name}`,
      resumen: `${actor.nombre} agregó ${formato.name} a ${qt.talent.displayName}.`,
    })

    return {
      id: linea.id,
      quoteTalentId: e.quoteTalentId,
      deliverableTypeId: e.deliverableTypeId,
      concepto: linea.description,
      detalle: linea.detail,
      cantidad: linea.quantity,
      unitAmountCents: linea.unitAmountCents,
      priceStatus: linea.priceStatus as EstadoPrecioDoc,
      permiteCantidad: formato.allowsQuantity,
      baseAmountCents: precio.baseAmountCents,
      basePriceStatus: precio.basePriceStatus as EstadoPrecioDoc,
      orden: linea.sortOrder,
    } satisfies RenglonHoja
  })
  return { revision, renglon: resultado }
}

export interface CambioRenglon {
  quoteId: string
  lineaId: string
  revision: number
  cantidad?: number
  unitAmountCents?: number | null
  priceStatus?: EstadoPrecioDoc
}

/**
 * Cambia cantidad, precio o estado de un renglón.
 *
 * No escribe en `TalentRate`: bajarle el precio a un talento para este cliente
 * no se lo baja para todos.
 */
export async function actualizarRenglon(
  c: CambioRenglon,
): Promise<{ revision: number; renglon: RenglonHoja }> {
  const { revision, resultado } = await conBloqueo(c.quoteId, c.revision, async (tx, actor) => {
    const antes = await tx.quoteLine.findUnique({
      where: { id: c.lineaId },
      select: {
        quoteId: true, description: true, quantity: true,
        unitAmountCents: true, priceStatus: true,
        quotePrice: { select: { baseAmountCents: true, basePriceStatus: true } },
        deliverableType: { select: { allowsQuantity: true } },
        quoteTalent: {
          select: {
            displayNameOverride: true,
            talent: { select: { displayName: true } },
          },
        },
      },
    })
    if (!antes || antes.quoteId !== c.quoteId) {
      throw new Error('Ese renglón no pertenece a esta cotización.')
    }

    if (c.cantidad !== undefined && (!Number.isInteger(c.cantidad) || c.cantidad < 1)) {
      throw new Error('La cantidad tiene que ser un entero mayor que cero.')
    }

    const estado = c.priceStatus ?? antes.priceStatus
    const datos: Prisma.QuoteLineUpdateInput = {}
    if (c.cantidad !== undefined) datos.quantity = c.cantidad
    if (c.priceStatus !== undefined) datos.priceStatus = c.priceStatus
    if (c.unitAmountCents !== undefined) {
      // Un renglón sin importe no es un renglón de cero: vaciar el campo lo
      // deja "por validar", que es lo que significa.
      datos.unitAmountCents = estado === 'QUOTED' ? c.unitAmountCents : null
    } else if (c.priceStatus !== undefined && c.priceStatus !== 'QUOTED') {
      datos.unitAmountCents = null
    }

    const despues = await tx.quoteLine.update({ where: { id: c.lineaId }, data: datos })

    const talento =
      antes.quoteTalent?.displayNameOverride ??
      antes.quoteTalent?.talent.displayName ??
      'la cotización'

    await append(tx, {
      actor,
      categoria: 'COTIZACION',
      accion: 'cotizacion.renglon_ajustado',
      entidadTipo: 'QuoteLine',
      entidadId: c.lineaId,
      entidadEtiqueta: `${talento} · ${antes.description}`,
      resumen:
        `${actor.nombre} ajustó ${antes.description} de ${talento}: ` +
        `${describir(antes.quantity, antes.priceStatus, antes.unitAmountCents)} → ` +
        `${describir(despues.quantity, despues.priceStatus, despues.unitAmountCents)}`,
      // Mientras alguien teclea un precio, cada pulsación produciría un apunte.
      coalescerPor: `renglon|${c.lineaId}`,
    })

    return {
      id: despues.id,
      quoteTalentId: despues.quoteTalentId!,
      deliverableTypeId: despues.deliverableTypeId,
      concepto: despues.description,
      detalle: despues.detail,
      cantidad: despues.quantity,
      unitAmountCents: despues.unitAmountCents,
      priceStatus: despues.priceStatus as EstadoPrecioDoc,
      permiteCantidad: antes.deliverableType?.allowsQuantity ?? true,
      baseAmountCents: antes.quotePrice?.baseAmountCents ?? null,
      basePriceStatus:
        (antes.quotePrice?.basePriceStatus as EstadoPrecioDoc | null) ?? null,
      orden: despues.sortOrder,
    } satisfies RenglonHoja
  })
  return { revision, renglon: resultado }
}

/** Borra un renglón. El deshacer de la interfaz lo vuelve a agregar. */
export async function quitarRenglon(
  quoteId: string,
  lineaId: string,
  revision: number,
): Promise<{ revision: number }> {
  const { revision: nueva } = await conBloqueo(quoteId, revision, async (tx, actor) => {
    const l = await tx.quoteLine.findUnique({
      where: { id: lineaId },
      select: { quoteId: true, description: true },
    })
    if (!l || l.quoteId !== quoteId) {
      throw new Error('Ese renglón no pertenece a esta cotización.')
    }
    await tx.quoteLine.delete({ where: { id: lineaId } })

    await append(tx, {
      actor,
      categoria: 'COTIZACION',
      accion: 'cotizacion.renglon_quitado',
      entidadTipo: 'Quote',
      entidadId: quoteId,
      entidadEtiqueta: l.description,
      resumen: `${actor.nombre} quitó ${l.description} de la cotización.`,
    })
  })
  return { revision: nueva }
}

export interface CambioEncabezado {
  quoteId: string
  revision: number
  cliente?: string
  proyecto?: string | null
}

/** Cliente y proyecto, que en la hoja son encabezado editable y no formulario. */
export async function actualizarEncabezado(
  c: CambioEncabezado,
): Promise<{ revision: number }> {
  const { revision } = await conBloqueo(c.quoteId, c.revision, async (tx, actor) => {
    const datos: Prisma.QuoteUpdateInput = {}

    if (c.cliente !== undefined) {
      const nombre = c.cliente.trim()
      if (!nombre) throw new Error('Escribe el nombre del cliente.')
      const cliente = await asegurarClientePorNombre(tx, nombre)
      datos.client = { connect: { id: cliente.id } }
    }
    if (c.proyecto !== undefined) datos.projectName = c.proyecto?.trim() || null

    if (Object.keys(datos).length === 0) return
    await tx.quote.update({ where: { id: c.quoteId }, data: datos })

    await append(tx, {
      actor,
      categoria: 'COTIZACION',
      accion: 'cotizacion.encabezado_editado',
      entidadTipo: 'Quote',
      entidadId: c.quoteId,
      entidadEtiqueta: c.cliente ?? c.proyecto ?? '',
      resumen: `${actor.nombre} editó el encabezado de la cotización.`,
      coalescerPor: `encabezado|${c.quoteId}`,
    })
  })
  return { revision }
}

/**
 * Encuentra o crea el cliente por nombre.
 *
 * Misma normalización que el tabulador, para que "Honor" y "HONOR" caigan en
 * el mismo registro y no se dupliquen los folios de una marca.
 */
async function asegurarClientePorNombre(tx: Prisma.TransactionClient, displayName: string) {
  const normalizedKey = displayName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()

  const existente = await tx.client.findUnique({ where: { normalizedKey } })
  if (existente) return existente

  const ocupados = new Set(
    (await tx.client.findMany({ select: { folioCode: true } })).map((c) => c.folioCode),
  )
  const { sugerirFolioCode } = await import('@/server/quote/folio')
  return tx.client.create({
    data: {
      displayName,
      normalizedKey,
      folioCode: sugerirFolioCode(displayName, ocupados),
    },
  })
}

function describir(cantidad: number, status: string, cents: number | null): string {
  const importe =
    status === 'QUOTED'
      ? cents === null ? '—' : formatMXN(cents)
      : status === 'PENDING'
        ? 'Por validar'
        : status === 'CASE_BY_CASE'
          ? 'Caso por caso'
          : 'No aplica'
  return `${cantidad} × ${importe}`
}
