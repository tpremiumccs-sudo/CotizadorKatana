import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ConflictoRevisionError } from '@/server/data/cotizacion'
import { ForbiddenError } from '@/lib/authz/policy'

/**
 * El protocolo de guardado de la hoja, en un solo lugar.
 *
 * Las mutaciones de la cotización comparten exactamente la misma envoltura:
 * leer la revisión de `If-Match`, validar el cuerpo, y traducir tres errores
 * conocidos a tres códigos de estado. Repetir eso en cada ruta es como se cuela
 * una que devuelve 400 donde debía devolver 409 y el cliente, en vez de avisar
 * del conflicto, revierte lo que el usuario acababa de escribir.
 */

/** Revisión del cliente, o la respuesta 428 que hay que devolverle. */
export function leerRevision(req: Request): number | NextResponse {
  const ifMatch = req.headers.get('if-match')
  const revision = Number(ifMatch)
  if (!ifMatch || !Number.isInteger(revision) || revision < 0) {
    return NextResponse.json(
      { error: 'Falta la cabecera If-Match con la revisión.' },
      { status: 428 }, // Precondition Required
    )
  }
  return revision
}

/** Cuerpo validado, o la respuesta 400 con el primer mensaje de zod. */
export async function leerCuerpo<T extends z.ZodTypeAny>(
  req: Request,
  esquema: T,
): Promise<z.infer<T> | NextResponse> {
  try {
    return esquema.parse(await req.json()) as z.infer<T>
  } catch (e) {
    const mensaje =
      e instanceof z.ZodError
        ? (e.issues[0]?.message ?? 'Datos inválidos.')
        : 'No se pudo leer la petición.'
    return NextResponse.json({ error: mensaje }, { status: 400 })
  }
}

/**
 * Corre la mutación y responde con la revisión nueva.
 *
 * El `etag` de la respuesta es lo que el cliente usará como `If-Match` en la
 * siguiente escritura, así que la cadena de bloqueo se mantiene sola.
 */
export async function responder<T extends { revision: number }>(
  trabajo: () => Promise<T>,
): Promise<NextResponse> {
  try {
    const r = await trabajo()
    return NextResponse.json(r, {
      status: 200,
      headers: { etag: String(r.revision), 'cache-control': 'no-store' },
    })
  } catch (e) {
    if (e instanceof ConflictoRevisionError) {
      return NextResponse.json(
        { error: e.message, revisionActual: e.revisionActual, quien: e.quienNombre },
        { status: 409, headers: { etag: String(e.revisionActual) } },
      )
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo guardar.' },
      { status: 400 },
    )
  }
}
