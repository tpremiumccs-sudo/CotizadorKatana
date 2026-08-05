import 'server-only'
import { prisma } from '@/lib/db'
import { append } from '@/server/audit/append'
import { autorizar } from '@/server/data/autorizar'
import { formatMXN } from '@/lib/money'
import type { EstadoPrecioDoc } from '@/lib/doc/tipos'

/**
 * El tarifario maestro: precios de lista por talento y formato.
 *
 * Es la fuente de la que copia cada cotización nueva. Cambiar aquí NO cambia
 * las cotizaciones ya armadas —copiaron su base cuando se crearon—, que es
 * justo lo que permite subir precios sin reescribir lo que ya se le mandó a una
 * marca.
 */

export interface CeldaTarifario {
  /** `null` si todavía no existe la fila. */
  id: string | null
  amountCents: number | null
  priceStatus: EstadoPrecioDoc
  editadaAMano: boolean
  revision: number
}

export interface FilaTarifario {
  talentId: string
  nombre: string
  codigo: string | null
  categoria: string | null
  /** Nota en prosa que NUNCA se parsea (la de Padigol son 704 caracteres). */
  notas: string | null
  esMenorDeEdad: boolean
  ausenteEnUltimoImport: boolean
  /** Indexado por deliverableTypeId. */
  celdas: Record<string, CeldaTarifario>
}

export interface ColumnaTarifario {
  id: string
  nombre: string
  etiquetaPdf: string
  categoria: string
  orden: number
}

export interface Tarifario {
  columnas: ColumnaTarifario[]
  filas: FilaTarifario[]
  /** Cuántas celdas hay de cada estado, para la cabecera. */
  conteos: Record<EstadoPrecioDoc, number>
}

export async function leerTarifario(): Promise<Tarifario> {
  await autorizar('tarifario.ver')

  const [formatos, talentos] = await Promise.all([
    prisma.deliverableType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true, name: true, pdfLabel: true, category: true, sortOrder: true,
      },
    }),
    prisma.talent.findMany({
      where: { isActive: true },
      orderBy: [{ displayName: 'asc' }],
      select: {
        id: true, displayName: true, code: true, category: true,
        rateNotes: true, esMenorDeEdad: true, missingInLastImport: true,
        rates: {
          select: {
            id: true, deliverableTypeId: true, amountCents: true,
            priceStatus: true, manuallyEditedAt: true, revision: true,
          },
        },
      },
    }),
  ])

  const conteos: Record<EstadoPrecioDoc, number> = {
    QUOTED: 0, PENDING: 0, NOT_APPLICABLE: 0, CASE_BY_CASE: 0,
  }

  const filas: FilaTarifario[] = talentos.map((t) => {
    const celdas: Record<string, CeldaTarifario> = {}
    for (const r of t.rates) {
      const estado = r.priceStatus as EstadoPrecioDoc
      celdas[r.deliverableTypeId] = {
        id: r.id,
        amountCents: r.amountCents,
        priceStatus: estado,
        editadaAMano: r.manuallyEditedAt !== null,
        revision: r.revision,
      }
      conteos[estado]++
    }
    return {
      talentId: t.id,
      nombre: t.displayName,
      codigo: t.code,
      categoria: t.category,
      notas: t.rateNotes,
      esMenorDeEdad: t.esMenorDeEdad,
      ausenteEnUltimoImport: t.missingInLastImport,
      celdas,
    }
  })

  return {
    columnas: formatos.map((f) => ({
      id: f.id,
      nombre: f.name,
      etiquetaPdf: f.pdfLabel,
      categoria: f.category,
      orden: f.sortOrder,
    })),
    filas,
    conteos,
  }
}

export interface GuardarTarifaEntrada {
  talentId: string
  deliverableTypeId: string
  amountCents: number | null
  priceStatus: EstadoPrecioDoc
  /** Revisión que el editor creía tener. `null` si la fila aún no existía. */
  revision: number | null
}

/** Error de bloqueo optimista sobre una tarifa del tarifario. */
export class ConflictoTarifaError extends Error {
  constructor() {
    super('Alguien cambió esta tarifa mientras la editabas. Vuelve a cargar.')
    this.name = 'ConflictoTarifaError'
  }
}

/**
 * Escribe una tarifa maestra.
 *
 * Deja `manuallyEditedAt`, que es lo que hace que un Excel viejo NO la pise en
 * la siguiente importación: aparecerá como conflicto y alguien tendrá que
 * decidir. Y guarda una revisión, para poder decir de dónde a dónde fue.
 */
export async function guardarTarifa(entrada: GuardarTarifaEntrada) {
  const actor = await autorizar('tarifario.editar', {
    entidadTipo: 'TalentRate',
    entidadId: `${entrada.talentId}|${entrada.deliverableTypeId}`,
  })

  if (entrada.priceStatus === 'QUOTED' && entrada.amountCents === null) {
    throw new Error('Un precio con tarifa necesita un importe.')
  }
  const monto = entrada.priceStatus === 'QUOTED' ? entrada.amountCents : null

  return prisma.$transaction(async (tx) => {
    const previa = await tx.talentRate.findUnique({
      where: {
        talentId_deliverableTypeId: {
          talentId: entrada.talentId,
          deliverableTypeId: entrada.deliverableTypeId,
        },
      },
    })

    if (previa && entrada.revision !== null && previa.revision !== entrada.revision) {
      throw new ConflictoTarifaError()
    }

    const [talento, formato] = await Promise.all([
      tx.talent.findUniqueOrThrow({
        where: { id: entrada.talentId },
        select: { displayName: true },
      }),
      tx.deliverableType.findUniqueOrThrow({
        where: { id: entrada.deliverableTypeId },
        select: { name: true },
      }),
    ])

    const tarifa = previa
      ? await tx.talentRate.update({
          where: { id: previa.id },
          data: {
            amountCents: monto,
            priceStatus: entrada.priceStatus,
            manuallyEditedAt: new Date(),
            lastChangeSource: 'MANUAL',
            actualizadoPorId: actor.id,
            revision: { increment: 1 },
          },
        })
      : await tx.talentRate.create({
          data: {
            talentId: entrada.talentId,
            deliverableTypeId: entrada.deliverableTypeId,
            amountCents: monto,
            priceStatus: entrada.priceStatus,
            manuallyEditedAt: new Date(),
            lastChangeSource: 'MANUAL',
            actualizadoPorId: actor.id,
          },
        })

    // La revisión es inmutable: es la historia que explica cada precio.
    await tx.talentRateRevision.create({
      data: {
        talentRateId: tarifa.id,
        talentId: entrada.talentId,
        deliverableTypeId: entrada.deliverableTypeId,
        beforeAmountCents: previa?.amountCents ?? null,
        beforePriceStatus: previa?.priceStatus ?? null,
        afterAmountCents: monto,
        afterPriceStatus: entrada.priceStatus,
        source: 'MANUAL',
        actorId: actor.id,
      },
    })

    const antes = describir(previa?.priceStatus ?? null, previa?.amountCents ?? null)
    const despues = describir(entrada.priceStatus, monto)

    await append(tx, {
      actor,
      categoria: 'TARIFARIO',
      accion: 'tarifario.precio_cambiado',
      entidadTipo: 'TalentRate',
      entidadId: tarifa.id,
      entidadEtiqueta: `${talento.displayName} · ${formato.name}`,
      resumen: previa
        ? `${actor.nombre} cambió la tarifa de ${talento.displayName} · ${formato.name} de ${antes} a ${despues}`
        : `${actor.nombre} puso la tarifa de ${talento.displayName} · ${formato.name} en ${despues}`,
      cambios: { precio: { antes, despues } },
      coalescerPor: `tarifa|${tarifa.id}`,
    })

    return {
      id: tarifa.id,
      amountCents: tarifa.amountCents,
      priceStatus: tarifa.priceStatus as EstadoPrecioDoc,
      editadaAMano: true,
      revision: tarifa.revision,
    }
  })
}

function describir(status: string | null, cents: number | null): string {
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
      return 'sin tarifa'
  }
}
