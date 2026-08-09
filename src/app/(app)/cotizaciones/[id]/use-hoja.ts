'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  EstadoHoja, RenglonHoja, TalentoHoja, EstadoPrecioHoja,
} from '@/lib/hoja/tipos'
import { totalesDeHoja } from '@/lib/hoja/tipos'

/**
 * El estado de la hoja y todas sus mutaciones.
 *
 * Dos decisiones gobiernan este archivo:
 *
 * 1. **Las escrituras van en fila, no en paralelo.** Cada petición lleva la
 *    revisión que el cliente cree tener y el servidor la incrementa. Si dos
 *    taps salen a la vez con la misma revisión, el segundo recibe un 409 —un
 *    conflicto consigo mismo, que es absurdo y además haría creer al usuario
 *    que otra persona está editando. Se encadenan en una promesa.
 *
 * 2. **El total se calcula aquí, no se pide.** `totalesDeHoja` es la misma
 *    función pura que corre el servidor al guardar, así que la cifra se mueve
 *    en la misma pulsación en la que se escribe.
 *
 * El nombre del gancho va en inglés —`useHoja` y no `usarHoja`— contra el
 * resto del repositorio: React exige el prefijo `use` para poder comprobar las
 * reglas de los ganchos, y perder esa comprobación por coherencia de idioma
 * saldría mucho más caro que la inconsistencia.
 */

export type FaseGuardado =
  | { fase: 'limpio' }
  | { fase: 'guardando' }
  | { fase: 'guardado' }
  | { fase: 'error'; mensaje: string }
  | { fase: 'conflicto'; mensaje: string; quien: string | null }

/** Lo necesario para rehacer un borrado, que es como se ofrece deshacer. */
interface Deshacer {
  etiqueta: string
  quoteTalentId: string
  deliverableTypeId: string
}

interface RespuestaError {
  error?: string
  quien?: string | null
}

export function useHoja(inicial: EstadoHoja, soloLectura: boolean) {
  const [doc, setDoc] = useState<EstadoHoja>(inicial)
  const [guardado, setGuardado] = useState<FaseGuardado>({ fase: 'limpio' })
  const [deshacer, setDeshacer] = useState<Deshacer | null>(null)

  // El servidor mandó datos nuevos (recarga, navegación): se adopta su versión.
  useEffect(() => { setDoc(inicial) }, [inicial])

  // La revisión viva. En una ref además del estado porque la cola de
  // escrituras la lee fuera del ciclo de render.
  const revision = useRef(inicial.revision)
  useEffect(() => { revision.current = doc.revision }, [doc.revision])

  const cola = useRef<Promise<unknown>>(Promise.resolve())
  const enConflicto = useRef(false)

  /**
   * Encola una escritura.
   *
   * Devuelve lo que respondió el servidor, o `null` si falló. Tras un conflicto
   * deja de mandar: seguir escribiendo sobre una revisión que ya no existe sólo
   * produce más conflictos.
   */
  const escribir = useCallback(
    async <T>(
      ruta: string,
      metodo: 'POST' | 'PATCH' | 'DELETE',
      cuerpo: unknown,
    ): Promise<T | null> => {
      if (soloLectura || enConflicto.current) return null

      const trabajo = async (): Promise<T | null> => {
        setGuardado({ fase: 'guardando' })
        try {
          const r = await fetch(ruta, {
            method: metodo,
            headers: {
              'content-type': 'application/json',
              'if-match': String(revision.current),
            },
            body: JSON.stringify(cuerpo),
          })

          if (r.status === 409) {
            const d = (await r.json()) as RespuestaError
            enConflicto.current = true
            setGuardado({
              fase: 'conflicto',
              mensaje: d.error ?? 'Alguien más guardó cambios.',
              quien: d.quien ?? null,
            })
            return null
          }

          if (!r.ok) {
            const d = (await r.json().catch(() => ({}))) as RespuestaError
            setGuardado({ fase: 'error', mensaje: d.error ?? 'No se pudo guardar.' })
            return null
          }

          const datos = (await r.json()) as T & { revision: number }
          revision.current = datos.revision
          setDoc((d) => ({ ...d, revision: datos.revision }))
          setGuardado({ fase: 'guardado' })
          return datos
        } catch {
          setGuardado({ fase: 'error', mensaje: 'Sin conexión. No se guardó.' })
          return null
        }
      }

      const siguiente = cola.current.then(trabajo, trabajo)
      cola.current = siguiente
      return siguiente as Promise<T | null>
    },
    [soloLectura],
  )

  const ruta = useCallback((sufijo: string) => `/api/cotizaciones/${doc.quoteId}/${sufijo}`, [doc.quoteId])

  // ───────────────────────────── Talentos ─────────────────────────────

  const agregarTalento = useCallback(
    async (talentId: string) => {
      // Ya está: el tap no debe duplicarlo ni parpadear.
      if (doc.talentos.some((t) => t.talentId === talentId)) return

      const r = await escribir<{ talento: TalentoHoja }>(ruta('talento'), 'POST', { talentId })
      if (!r) return
      setDoc((d) =>
        d.talentos.some((t) => t.id === r.talento.id)
          ? d
          : { ...d, talentos: [...d.talentos, r.talento] },
      )
    },
    [doc.talentos, escribir, ruta],
  )

  const quitarTalento = useCallback(
    async (quoteTalentId: string) => {
      const antes = doc.talentos
      setDoc((d) => ({ ...d, talentos: d.talentos.filter((t) => t.id !== quoteTalentId) }))
      const r = await escribir(ruta('talento'), 'DELETE', { quoteTalentId })
      if (!r) setDoc((d) => ({ ...d, talentos: antes }))
    },
    [doc.talentos, escribir, ruta],
  )

  // ───────────────────────────── Renglones ────────────────────────────

  const agregarRenglon = useCallback(
    async (quoteTalentId: string, deliverableTypeId: string) => {
      const r = await escribir<{ renglon: RenglonHoja }>(ruta('linea'), 'POST', {
        quoteTalentId,
        deliverableTypeId,
      })
      if (!r) return
      setDoc((d) => ({
        ...d,
        talentos: d.talentos.map((t) =>
          t.id === quoteTalentId ? { ...t, renglones: [...t.renglones, r.renglon] } : t,
        ),
      }))
    },
    [escribir, ruta],
  )

  const cambiarRenglon = useCallback(
    async (
      lineaId: string,
      cambio: {
        cantidad?: number
        unitAmountCents?: number | null
        priceStatus?: EstadoPrecioHoja
      },
    ) => {
      // Se aplica antes de salir a la red: el total tiene que moverse ya.
      setDoc((d) => ({
        ...d,
        talentos: d.talentos.map((t) => ({
          ...t,
          renglones: t.renglones.map((r) =>
            r.id === lineaId
              ? {
                  ...r,
                  cantidad: cambio.cantidad ?? r.cantidad,
                  priceStatus: cambio.priceStatus ?? r.priceStatus,
                  unitAmountCents:
                    cambio.unitAmountCents !== undefined
                      ? cambio.unitAmountCents
                      : r.unitAmountCents,
                }
              : r,
          ),
        })),
      }))

      const r = await escribir<{ renglon: RenglonHoja }>(ruta('linea'), 'PATCH', {
        lineaId,
        ...cambio,
      })
      if (!r) return
      // El servidor manda la verdad: puede haber anulado el importe al cambiar
      // de estado, y el cliente no debe adivinar esa regla por su cuenta.
      setDoc((d) => ({
        ...d,
        talentos: d.talentos.map((t) => ({
          ...t,
          renglones: t.renglones.map((x) => (x.id === lineaId ? r.renglon : x)),
        })),
      }))
    },
    [escribir, ruta],
  )

  const quitarRenglon = useCallback(
    async (lineaId: string) => {
      const talento = doc.talentos.find((t) => t.renglones.some((r) => r.id === lineaId))
      const renglon = talento?.renglones.find((r) => r.id === lineaId)

      setDoc((d) => ({
        ...d,
        talentos: d.talentos.map((t) => ({
          ...t,
          renglones: t.renglones.filter((r) => r.id !== lineaId),
        })),
      }))

      const r = await escribir(ruta('linea'), 'DELETE', { lineaId })
      if (!r) {
        setDoc(doc) // no se borró: se devuelve como estaba
        return
      }
      if (talento && renglon?.deliverableTypeId) {
        setDeshacer({
          etiqueta: `${renglon.concepto} eliminado`,
          quoteTalentId: talento.id,
          deliverableTypeId: renglon.deliverableTypeId,
        })
      }
    },
    [doc, escribir, ruta],
  )

  const rehacer = useCallback(async () => {
    if (!deshacer) return
    const d = deshacer
    setDeshacer(null)
    await agregarRenglon(d.quoteTalentId, d.deliverableTypeId)
  }, [deshacer, agregarRenglon])

  // ───────────────────────────── Encabezado ───────────────────────────

  const cambiarEncabezado = useCallback(
    async (cambio: { cliente?: string; proyecto?: string | null }) => {
      setDoc((d) => ({
        ...d,
        cliente: cambio.cliente ?? d.cliente,
        proyecto: cambio.proyecto !== undefined ? cambio.proyecto : d.proyecto,
      }))
      await escribir(ruta('encabezado'), 'PATCH', cambio)
    },
    [escribir, ruta],
  )

  // El total: la misma función pura que corre el servidor.
  const totales = useMemo(() => totalesDeHoja(doc), [doc])

  return {
    doc,
    totales,
    guardado,
    deshacer,
    rehacer,
    descartarDeshacer: () => setDeshacer(null),
    agregarTalento,
    quitarTalento,
    agregarRenglon,
    cambiarRenglon,
    quitarRenglon,
    cambiarEncabezado,
  }
}
