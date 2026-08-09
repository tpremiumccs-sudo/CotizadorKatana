import 'server-only'
import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import type { PlanImportacion, EntradaPlanTalento } from './types'
import { ALIAS_SEMBRADOS, normalizeName } from './identity'
import { FORMATO_POR_CODE } from './catalogo'

/**
 * Aplica un plan de importación ya confirmado.
 *
 * Todo ocurre en UNA transacción: o entra el archivo completo o no entra nada.
 * Una importación a medias dejaría el tarifario en un estado que nadie sabría
 * interpretar.
 *
 * Es idempotente por `commitKey` = sha256(archivo + decisiones). Un doble clic
 * en "Aplicar", o un reintento tras un fallo de red, devuelven el resultado del
 * primer intento en vez de duplicar talentos y tarifas.
 */

export interface DecisionesImport {
  /** normalizado → talentId al que el usuario decidió asignarlo. */
  asignaciones?: Record<string, string>
  /** normalizados que el usuario decidió dar de alta como talento nuevo. */
  crearNuevos?: string[]
  /** normalizados que el usuario decidió ignorar en esta importación. */
  ignorar?: string[]
  /** "talentId|CODIGO_FORMATO" → qué hacer con el conflicto. */
  conflictos?: Record<string, 'CONSERVAR_APP' | 'TOMAR_ARCHIVO'>
}

export interface ResultadoCommit {
  importBatchId: string
  talentosCreados: number
  talentosActualizados: number
  tarifasEscritas: number
  metricasEscritas: number
  identificadoresCreados: number
  omitidos: number
  yaAplicado: boolean
}

export function calcularCommitKey(
  sha256Archivo: string,
  decisiones: DecisionesImport,
): string {
  // JSON canónico: las claves ordenadas para que dos objetos equivalentes den
  // la misma huella independientemente del orden de inserción.
  const canonico = JSON.stringify(decisiones, Object.keys(decisiones).sort())
  return createHash('sha256').update(`${sha256Archivo}|${canonico}`).digest('hex')
}

const ALIAS_POR_CODIGO = new Map(ALIAS_SEMBRADOS.map((a) => [a.codigo, a.alias]))

function slugificar(nombre: string): string {
  return (
    normalizeName(nombre).replace(/\s+/g, '-').slice(0, 60) || 'talento'
  )
}

export async function commitImport(
  prisma: PrismaClient,
  plan: PlanImportacion,
  decisiones: DecisionesImport,
  actor: { id: string; nombre: string },
): Promise<ResultadoCommit> {
  const commitKey = calcularCommitKey(plan.sha256, decisiones)

  const previo = await prisma.importBatch.findUnique({ where: { commitKey } })
  if (previo?.status === 'COMMITTED') {
    return {
      ...(previo.stats as unknown as Omit<ResultadoCommit, 'yaAplicado' | 'importBatchId'>),
      importBatchId: previo.id,
      yaAplicado: true,
    }
  }

  const ignorar = new Set(decisiones.ignorar ?? [])
  const asignaciones = decisiones.asignaciones ?? {}
  const conflictos = decisiones.conflictos ?? {}

  return prisma.$transaction(
    async (tx) => {
      const lote = await tx.importBatch.create({
        data: {
          kind: plan.tipo,
          originalFileName: plan.archivo,
          sha256: plan.sha256,
          sizeBytes: 0,
          storagePath: '',
          status: 'PREVIEWED',
          uploadedById: actor.id,
          commitKey,
          plan: plan as unknown as Prisma.InputJsonValue,
          decisions: decisiones as unknown as Prisma.InputJsonValue,
        },
      })

      const formatos = await tx.deliverableType.findMany()
      const formatoIdPorCode = new Map(formatos.map((f) => [f.code, f.id]))

      const r: ResultadoCommit = {
        importBatchId: lote.id,
        talentosCreados: 0,
        talentosActualizados: 0,
        tarifasEscritas: 0,
        metricasEscritas: 0,
        identificadoresCreados: 0,
        omitidos: 0,
        yaAplicado: false,
      }

      for (const e of plan.talentos) {
        if (ignorar.has(e.normalizado)) {
          r.omitidos++
          continue
        }

        // El usuario pudo redirigir una identidad ambigua a un talento concreto.
        const asignado = asignaciones[e.normalizado]
        const talentId = asignado ?? e.talentIdExistente
        const campos = extraerCampos(e)

        let idFinal: string
        if (talentId) {
          await tx.talent.update({
            where: { id: talentId },
            data: {
              ...campos,
              missingInLastImport: false,
              actualizadoPorId: actor.id,
              actualizadoPorNombre: actor.nombre,
            },
          })
          idFinal = talentId
          r.talentosActualizados++
        } else {
          // Una identidad sin resolver NO se da de alta sola: hace falta que el
          // usuario lo pida, o se quedaría un duplicado en el roster.
          const pedidoNuevo = (decisiones.crearNuevos ?? []).includes(e.normalizado)
          if (e.identidad?.decision === 'REQUIERE_REVISION' && !pedidoNuevo) {
            r.omitidos++
            continue
          }
          const creado = await tx.talent.create({
            data: {
              ...campos,
              code: e.codigo ?? null,
              canonicalName:
                typeof campos.canonicalName === 'string' ? campos.canonicalName : e.crudo,
              displayName: e.displayName || e.crudo,
              slug: await slugLibre(tx, slugificar(e.displayName || e.crudo)),
              actualizadoPorId: actor.id,
              actualizadoPorNombre: actor.nombre,
            },
          })
          idFinal = creado.id
          r.talentosCreados++
        }

        r.identificadoresCreados += await registrarIdentificadores(tx, idFinal, e)
        r.tarifasEscritas += await escribirTarifas(
          tx, idFinal, e, formatoIdPorCode, conflictos, lote.id, actor.id,
        )
        r.metricasEscritas += await escribirMetricas(tx, idFinal, e, lote.id)
      }

      // Un talento que el archivo no trae se MARCA, nunca se borra: el archivo
      // puede venir incompleto y borrar tarifas sería irreversible.
      for (const a of plan.ausentes) {
        await tx.talent.update({
          where: { id: a.talentId },
          data: { missingInLastImport: true },
        })
      }

      await tx.importBatch.update({
        where: { id: lote.id },
        data: {
          status: 'COMMITTED',
          committedAt: new Date(),
          stats: r as unknown as Prisma.InputJsonValue,
        },
      })

      await tx.bitacora.create({
        data: {
          actorId: actor.id,
          actorNombre: actor.nombre,
          categoria: 'IMPORTACION',
          accion: 'importacion.aplicada',
          entidadTipo: 'ImportBatch',
          entidadId: lote.id,
          entidadEtiqueta: plan.archivo,
          resumen:
            `${actor.nombre} importó ${plan.archivo}: ` +
            `${r.talentosCreados} talento(s) nuevo(s), ` +
            `${r.talentosActualizados} actualizado(s), ` +
            `${r.tarifasEscritas} tarifa(s) escrita(s).`,
          metadatos: r as unknown as Prisma.InputJsonValue,
        },
      })

      return r
    },
    { timeout: 120_000, isolationLevel: 'ReadCommitted' },
  )
}

// ─────────────────────────── auxiliares ───────────────────────────

/**
 * Los campos del talento que el importador puede escribir.
 *
 * Es una lista blanca a propósito: el plan puede proponer un campo que el
 * modelo no tenga y aquí se descarta en vez de reventar. Pero descartar en
 * silencio tiene su propio precio — `commercialNotes` y los enlaces del roster
 * se planeaban y se tiraban en cada importación, así que el CRM traía las notas
 * comerciales de la agencia y el sistema nunca las guardaba. Si se añade un
 * campo al plan, tiene que entrar también aquí Y al modelo.
 */
export const CAMPOS_TALENTO = new Set([
  // `displayName` está aquí porque la hoja TALENTOS es la autoridad sobre el
  // nombre que se imprime. Sin él, el nombre se congelaba en la grafía de la
  // primera hoja que creó el registro y no había forma de corregirlo
  // reimportando.
  'canonicalName', 'displayName', 'category', 'relationshipType', 'country', 'city',
  'primaryPlatformNote', 'rateNotes', 'rateSourceLabel', 'bio',
  'driveFolderId', 'verticals', 'roster',
  'commercialNotes', 'username', 'linkInstagram', 'linkTiktok', 'linkYoutube',
])

function extraerCampos(e: EntradaPlanTalento): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [campo, cambio] of Object.entries(e.cambiosTalento)) {
    if (!CAMPOS_TALENTO.has(campo)) continue
    if (cambio.despues === undefined || cambio.despues === '') continue
    out[campo] = cambio.despues
  }
  // El estatus del tarifario llega como texto libre del Excel.
  const crudoEstado = e.cambiosTalento.rateStatusRaw?.despues
  if (typeof crudoEstado === 'string') {
    out.rateStatusRaw = crudoEstado
    out.rateStatus = mapearEstadoTarifa(crudoEstado)
  }
  return out
}

function mapearEstadoTarifa(crudo: string): string {
  const n = crudo.toLowerCase()
  if (n.includes('activo')) return 'ACTIVO'
  if (n.includes('incompleto')) return 'INCOMPLETO'
  if (n.includes('capturado')) return 'CAPTURADO'
  if (n.includes('histor')) return 'REFERENCIA_HISTORICA'
  return 'PENDIENTE'
}

async function slugLibre(tx: Prisma.TransactionClient, base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const s = i === 0 ? base : `${base}-${i + 1}`
    const existe = await tx.talent.findUnique({ where: { slug: s }, select: { id: true } })
    if (!existe) return s
  }
  return `${base}-${Date.now()}`
}

/**
 * Registra todas las grafías conocidas del talento.
 *
 * Incluye los alias sembrados a mano, que son los que ninguna métrica puede
 * inferir: sin "Ronaldo BXM → KT-004", la siguiente importación del roster
 * crearía un Ronny duplicado.
 */
async function registrarIdentificadores(
  tx: Prisma.TransactionClient,
  talentId: string,
  e: EntradaPlanTalento,
): Promise<number> {
  const formas = new Set<string>([e.crudo, e.displayName])
  const canonico = e.cambiosTalento.canonicalName?.despues
  if (typeof canonico === 'string') formas.add(canonico)
  if (e.codigo) {
    for (const a of ALIAS_POR_CODIGO.get(e.codigo) ?? []) formas.add(a)
  }

  let creados = 0
  for (const forma of formas) {
    const normalizado = normalizeName(forma)
    if (!normalizado) continue
    // Si otro talento ya reclamó esa grafía, se respeta: el índice de identidad
    // es único a propósito y una colisión es señal de duplicado, no un detalle.
    const existente = await tx.talentIdentifier.findUnique({ where: { normalized: normalizado } })
    if (existente) continue

    await tx.talentIdentifier.create({
      data: {
        talentId,
        raw: forma,
        normalized: normalizado,
        isCanonical: forma === canonico,
        source: e.codigo ? 'PERFIL_COMERCIAL' : 'IMPORT_MATCH',
      },
    })
    creados++
  }
  return creados
}

async function escribirTarifas(
  tx: Prisma.TransactionClient,
  talentId: string,
  e: EntradaPlanTalento,
  formatoIdPorCode: Map<string, string>,
  conflictos: Record<string, 'CONSERVAR_APP' | 'TOMAR_ARCHIVO'>,
  importBatchId: string,
  actorId: string,
): Promise<number> {
  let n = 0
  for (const c of e.cambiosTarifas) {
    const deliverableTypeId = formatoIdPorCode.get(c.deliverableCode)
    if (!deliverableTypeId) continue

    // Ante un conflicto, por omisión gana lo que hay en la app: un Excel viejo
    // no debe pisar un precio que alguien ajustó a mano.
    if (c.conflicto) {
      const decision = conflictos[`${talentId}|${c.deliverableCode}`] ?? 'CONSERVAR_APP'
      if (decision === 'CONSERVAR_APP') continue
    }

    const previa = await tx.talentRate.findUnique({
      where: { talentId_deliverableTypeId: { talentId, deliverableTypeId } },
    })

    const datos = {
      amountCents: c.despuesAmountCents,
      priceStatus: c.despuesPriceStatus as 'QUOTED' | 'PENDING' | 'NOT_APPLICABLE' | 'CASE_BY_CASE',
      lastChangeSource: 'IMPORT' as const,
      lastImportBatchId: importBatchId,
      note: FORMATO_POR_CODE.get(c.deliverableCode)?.name ?? null,
      actualizadoPorId: actorId,
    }

    const tarifa = previa
      ? await tx.talentRate.update({
          where: { id: previa.id },
          data: { ...datos, revision: { increment: 1 } },
        })
      : await tx.talentRate.create({
          data: { talentId, deliverableTypeId, ...datos },
        })

    await tx.talentRateRevision.create({
      data: {
        talentRateId: tarifa.id,
        talentId,
        deliverableTypeId,
        beforeAmountCents: previa?.amountCents ?? null,
        beforePriceStatus: previa?.priceStatus ?? null,
        afterAmountCents: c.despuesAmountCents,
        afterPriceStatus: datos.priceStatus,
        source: 'IMPORT',
        importBatchId,
        actorId,
      },
    })
    n++
  }
  return n
}

async function escribirMetricas(
  tx: Prisma.TransactionClient,
  talentId: string,
  e: EntradaPlanTalento,
  importBatchId: string,
): Promise<number> {
  if (e.metricas.length === 0) return 0

  // Sin fecha de corte en el archivo, se ancla al día para que re-importar el
  // mismo archivo el mismo día no inserte filas repetidas.
  const capturedAt = new Date(new Date().toISOString().slice(0, 10))

  // `skipDuplicates` se traduce a ON CONFLICT DO NOTHING, que es la única forma
  // correcta de ignorar un choque DENTRO de una transacción: capturar la
  // excepción no la deshace — Postgres aborta la transacción entera y todo lo
  // que venga después falla con "current transaction is aborted".
  const { count } = await tx.talentMetric.createMany({
    data: e.metricas.map((m) => ({
      talentId,
      platform: m.plataforma as 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'FACEBOOK' | 'TWITCH' | 'KICK' | 'X' | 'OTRA',
      followers: m.seguidores,
      rawValue: m.crudo,
      parseStatus:
        m.confianza === 'EXACTO' ? 'EXACT' : m.confianza === 'INFERIDO' ? 'INFERRED' : 'FAILED',
      needsReview: m.requiereRevision,
      notes: m.notas,
      capturedAt,
      importBatchId,
    })),
    skipDuplicates: true,
  })
  return count
}
