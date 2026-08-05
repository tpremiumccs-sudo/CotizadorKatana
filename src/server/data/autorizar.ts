import 'server-only'
import { prisma } from '@/lib/db'
import { leerSesion, contextoPeticion } from '@/server/auth/session'
import { append, type CategoriaBitacora } from '@/server/audit/append'
import {
  can, ForbiddenError, etiquetaRol,
  type Accion, type Actor, type Recurso,
} from '@/lib/authz/policy'

/**
 * Puerta única de las acciones que escriben.
 *
 * Ocultar un botón no protege nada: una Server Action es un endpoint HTTP y
 * cualquiera con la sesión abierta puede invocarla a mano. Por eso toda acción
 * empieza llamando aquí, y aquí pasan dos cosas inseparables:
 *
 *  1. Se decide con `can()` — la misma función pura que usa la interfaz, así que
 *     lo que se ve y lo que se permite no pueden separarse.
 *  2. Si se niega, el intento QUEDA REGISTRADO antes de lanzar. Un permiso
 *     denegado es justo el evento que interesa auditar; si sólo lanzara, el
 *     intento sería invisible.
 *
 * El registro del rechazo va en su propia transacción, no en la de la operación
 * —que ni siquiera llegó a abrirse—, y sobrevive al error.
 */

/** A qué categoría de la bitácora pertenece cada acción. */
const CATEGORIA: Record<Accion, CategoriaBitacora> = {
  'cotizacion.ver': 'COTIZACION',
  'cotizacion.crear': 'COTIZACION',
  'cotizacion.editar': 'COTIZACION',
  'cotizacion.eliminar': 'COTIZACION',
  'cotizacion.emitir': 'COTIZACION',
  'cotizacion.aprobar': 'COTIZACION',
  'cotizacion.descargarPdf': 'DOCUMENTO',
  'talento.ver': 'CATALOGO',
  'talento.editar': 'CATALOGO',
  'tarifario.ver': 'TARIFARIO',
  'tarifario.editar': 'TARIFARIO',
  'importacion.subir': 'IMPORTACION',
  'importacion.aplicar': 'IMPORTACION',
  'usuario.ver': 'USUARIOS',
  'usuario.administrar': 'USUARIOS',
  'bitacora.ver': 'SISTEMA',
  'ajustes.editar': 'AJUSTES',
}

export interface ContextoAccion {
  recurso?: Recurso
  /** "KAT-HON-2026-001" o "Ronny · TikTok + réplica Reel", para leer la bitácora. */
  entidadEtiqueta?: string
  entidadTipo?: string
  entidadId?: string
}

/**
 * Exige permiso para una acción y devuelve el actor.
 *
 * Lanza `ForbiddenError` si no lo tiene — y deja el rastro. Sin sesión lanza
 * igual: una acción no redirige, responde que no.
 */
export async function autorizar(
  accion: Accion,
  ctx: ContextoAccion = {},
): Promise<Actor> {
  const sesion = await leerSesion()
  const actor = sesion?.actor ?? null
  const decision = can(actor, accion, ctx.recurso ?? {})

  if (decision.permitido) return actor as Actor

  const peticion = await contextoPeticion()
  const quien = actor
    ? `${actor.nombre} (${etiquetaRol(actor.rol)})`
    : 'Alguien sin sesión'

  // El registro no puede tumbar la denegación: si la bitácora falla, se niega
  // igual. Lo contrario —dejar pasar porque no se pudo auditar— sería peor.
  try {
    await prisma.$transaction(async (tx) => {
      await append(tx, {
        actor,
        categoria: CATEGORIA[accion],
        accion: `permiso.denegado:${accion}`,
        entidadTipo: ctx.entidadTipo,
        entidadId: ctx.entidadId,
        entidadEtiqueta: ctx.entidadEtiqueta,
        resumen: `${quien} intentó ${DESCRIPCION[accion]} y no tiene permiso: ${decision.motivo}`,
        metadatos: { accion, recurso: ctx.recurso ?? {} },
        exito: false,
        ip: peticion.ip,
        userAgent: peticion.userAgent,
        sesionId: sesion?.sesionId,
      })
    })
  } catch {
    // Se ignora a propósito: el rechazo de abajo es lo que importa.
  }

  throw new ForbiddenError(accion, decision.motivo)
}

/** Cómo se nombra cada acción dentro de una frase de bitácora. */
const DESCRIPCION: Record<Accion, string> = {
  'cotizacion.ver': 'ver una cotización',
  'cotizacion.crear': 'crear una cotización',
  'cotizacion.editar': 'editar una cotización',
  'cotizacion.eliminar': 'eliminar una cotización',
  'cotizacion.emitir': 'emitir una cotización',
  'cotizacion.aprobar': 'aprobar una cotización',
  'cotizacion.descargarPdf': 'descargar un PDF',
  'talento.ver': 'ver una ficha de talento',
  'talento.editar': 'editar una ficha de talento',
  'tarifario.ver': 'consultar el tarifario',
  'tarifario.editar': 'modificar el tarifario',
  'importacion.subir': 'subir un archivo de importación',
  'importacion.aplicar': 'aplicar una importación',
  'usuario.ver': 'ver los usuarios',
  'usuario.administrar': 'administrar usuarios',
  'bitacora.ver': 'consultar la bitácora',
  'ajustes.editar': 'cambiar los ajustes',
}

export { CATEGORIA, DESCRIPCION }
