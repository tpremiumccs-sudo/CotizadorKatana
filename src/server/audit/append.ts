import 'server-only'
import type { Prisma } from '@prisma/client'
import type { Actor } from '@/lib/authz/policy'

/**
 * Bitácora de cambios.
 *
 * Espeja el modelo mental que la agencia ya tiene en la hoja HISTORIAL TALENTOS
 * de su Excel: Fecha · Talento · Campo · Valor anterior · Valor nuevo · Usuario
 * · Fuente · Tipo de cambio. Por eso cada evento guarda un `resumen` en español
 * ya redactado: la pantalla de bitácora se lee, no se descifra.
 *
 * La tabla es de solo inserción (hay un trigger que bloquea el DELETE) y el
 * actor se copia por valor —email, nombre y rol— para que el histórico no se
 * reescriba si alguien cambia de nombre o de rol después.
 */

export type CategoriaBitacora =
  | 'AUTENTICACION'
  | 'USUARIOS'
  | 'CATALOGO'
  | 'TARIFARIO'
  | 'COTIZACION'
  | 'DOCUMENTO'
  | 'IMPORTACION'
  | 'AJUSTES'
  | 'SISTEMA'

export interface EventoBitacora {
  actor: Actor | null
  categoria: CategoriaBitacora
  /** "tarifario.precio_base_cambiado" */
  accion: string
  entidadTipo?: string
  entidadId?: string
  /** "KAT-HON-2026-001" o "Ronny · TikTok + réplica Reel" */
  entidadEtiqueta?: string
  /** Frase en español lista para pintar. */
  resumen: string
  cambios?: Record<string, { antes: unknown; despues: unknown }>
  metadatos?: Record<string, unknown>
  exito?: boolean
  ip?: string
  userAgent?: string
  sesionId?: string
  /**
   * Clave de coalescencia. Si se repite dentro de la ventana, se ACTUALIZA el
   * evento en vez de insertar otro.
   */
  coalescerPor?: string
}

/** Ventana de coalescencia: cinco minutos. */
const VENTANA_MS = 5 * 60_000

/**
 * Registra un evento.
 *
 * SIEMPRE recibe la transacción: si la operación se deshace, su rastro también.
 * Un apunte de "se cambió el precio" sin el cambio real sería peor que no tener
 * bitácora.
 *
 * Coalescencia: mientras alguien teclea un precio, cada pulsación produciría un
 * evento. Con `coalescerPor` se agrupan los cambios del mismo actor sobre el
 * mismo campo dentro de cinco minutos, conservando el valor ANTES del primero y
 * el DESPUÉS del último. Las transiciones de estado nunca se coalescen: cada
 * "enviada", "aceptada" o "cancelada" es un hecho propio.
 */
export async function append(
  tx: Prisma.TransactionClient,
  evento: EventoBitacora,
): Promise<void> {
  const ahora = new Date()

  const base = {
    actorId: evento.actor?.id ?? null,
    actorEmail: evento.actor?.email ?? null,
    actorNombre: evento.actor?.nombre ?? null,
    actorRol: evento.actor?.rol ?? null,
    categoria: evento.categoria,
    accion: evento.accion,
    entidadTipo: evento.entidadTipo ?? null,
    entidadId: evento.entidadId ?? null,
    entidadEtiqueta: evento.entidadEtiqueta ?? null,
    resumen: evento.resumen,
    cambios: (evento.cambios ?? undefined) as Prisma.InputJsonValue | undefined,
    metadatos: (evento.metadatos ?? undefined) as Prisma.InputJsonValue | undefined,
    exito: evento.exito ?? true,
    ip: evento.ip ?? null,
    userAgent: evento.userAgent?.slice(0, 500) ?? null,
    sesionId: evento.sesionId ?? null,
  }

  if (!evento.coalescerPor) {
    await tx.bitacora.create({ data: base })
    return
  }

  // La ventana se identifica por actor + ACCIÓN + clave + bloque de 5 minutos.
  //
  // La acción entra en la clave porque hechos distintos no se pueden fundir:
  // ajustar un precio y luego revertirlo comparten la celda, y sin esto el
  // segundo reescribiría el apunte del primero dejando un registro que dice
  // "ajustó" cuando lo que pasó fue "revirtió".
  const bloque = Math.floor(ahora.getTime() / VENTANA_MS)
  const ventana = `${evento.actor?.id ?? 'anon'}|${evento.accion}|${evento.coalescerPor}|${bloque}`

  const previo = await tx.bitacora.findUnique({ where: { ventana } })
  if (!previo) {
    await tx.bitacora.create({ data: { ...base, ventana } })
    return
  }

  // Se conserva el "antes" del primer cambio de la ventana y se actualiza el
  // "después": el resultado es un solo apunte que dice de dónde a dónde fue.
  const cambiosPrevios = (previo.cambios ?? {}) as Record<
    string,
    { antes: unknown; despues: unknown }
  >
  const fusionados: Record<string, { antes: unknown; despues: unknown }> = {
    ...cambiosPrevios,
  }
  for (const [campo, cambio] of Object.entries(evento.cambios ?? {})) {
    fusionados[campo] = {
      antes: cambiosPrevios[campo]?.antes ?? cambio.antes,
      despues: cambio.despues,
    }
  }

  await tx.bitacora.update({
    where: { ventana },
    data: {
      resumen: evento.resumen,
      cambios: fusionados as Prisma.InputJsonValue,
      ocurridoEn: ahora,
    },
  })
}

/**
 * Redacta la frase de un cambio de precio.
 *
 * Es la que se lee en el historial de la cotización, así que se escribe como se
 * lo contaría un compañero: quién, qué formato, de cuánto a cuánto.
 */
export function frasePrecio(
  actorNombre: string,
  talento: string,
  formato: string,
  antes: string,
  despues: string,
): string {
  return `${actorNombre} ajustó ${talento} · ${formato} de ${antes} a ${despues}`
}
