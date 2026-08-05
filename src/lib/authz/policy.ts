/**
 * Política de permisos.
 *
 * Función PURA sin dependencias de servidor: se importa igual desde la interfaz
 * (para ocultar lo que no aplica) y desde el servidor (para impedirlo). Ocultar
 * un botón no protege nada — cualquiera puede invocar la acción por HTTP —, así
 * que la interfaz usa esto para no mentir y el servidor para decidir.
 */

export type Rol = 'ADMIN' | 'COMERCIAL' | 'LECTURA'

export interface Actor {
  id: string
  nombre: string
  email: string
  rol: Rol
  estado: 'ACTIVO' | 'SUSPENDIDO' | 'DESACTIVADO'
  esAprobador: boolean
}

export type Accion =
  // Cotizaciones
  | 'cotizacion.ver'
  | 'cotizacion.crear'
  | 'cotizacion.editar'
  | 'cotizacion.eliminar'
  | 'cotizacion.emitir'
  | 'cotizacion.aprobar'
  | 'cotizacion.descargarPdf'
  // Catálogo
  | 'talento.ver'
  | 'talento.editar'
  | 'tarifario.ver'
  | 'tarifario.editar'
  // Importación
  | 'importacion.subir'
  | 'importacion.aplicar'
  // Administración
  | 'usuario.ver'
  | 'usuario.administrar'
  | 'bitacora.ver'
  | 'ajustes.editar'

export interface Recurso {
  /** Quién creó el recurso, para distinguir propio de ajeno. */
  creadoPorId?: string
  /** Estado de la cotización, cuando aplica. */
  estado?: string
  /** La cotización requiere aprobación antes de emitirse. */
  requiereAprobacion?: boolean
}

export interface Decision {
  permitido: boolean
  /** Frase en español para el mensaje de error y para la bitácora. */
  motivo: string
}

const PERMITIDO: Decision = { permitido: true, motivo: '' }

function negar(motivo: string): Decision {
  return { permitido: false, motivo }
}

/**
 * Estados desde los que una cotización ya no se edita.
 *
 * Una cotización enviada es un documento que la marca ya tiene: cambiarla en
 * silencio dejaría la copia del cliente y la del sistema diciendo cosas
 * distintas. Para modificarla hay que crear una versión nueva.
 */
const ESTADOS_CERRADOS = new Set(['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'])

export function can(actor: Actor | null, accion: Accion, recurso: Recurso = {}): Decision {
  if (!actor) return negar('Necesitas iniciar sesión.')

  if (actor.estado === 'SUSPENDIDO') {
    return negar('Tu cuenta está suspendida. Pide a un administrador que la reactive.')
  }
  if (actor.estado === 'DESACTIVADO') {
    return negar('Tu cuenta está desactivada.')
  }

  const esAdmin = actor.rol === 'ADMIN'
  const esComercial = actor.rol === 'COMERCIAL'
  const esPropio = recurso.creadoPorId === undefined || recurso.creadoPorId === actor.id
  const cerrada = recurso.estado !== undefined && ESTADOS_CERRADOS.has(recurso.estado)

  switch (accion) {
    // ── Lectura: los tres roles ven ────────────────────────────────────
    case 'cotizacion.ver':
    case 'cotizacion.descargarPdf':
    case 'talento.ver':
    case 'tarifario.ver':
      return PERMITIDO

    // ── Cotizaciones ───────────────────────────────────────────────────
    case 'cotizacion.crear':
      return esAdmin || esComercial
        ? PERMITIDO
        : negar('Tu rol es de solo lectura: puedes consultar y descargar, no crear.')

    case 'cotizacion.editar':
      if (!esAdmin && !esComercial) {
        return negar('Tu rol es de solo lectura: puedes consultar y descargar, no editar.')
      }
      if (cerrada) {
        return negar(
          `La cotización está en estado ${recurso.estado} y ya no se edita. ` +
            'Duplícala para trabajar sobre una versión nueva.',
        )
      }
      if (!esAdmin && !esPropio) {
        return negar('Solo puedes editar las cotizaciones que tú creaste.')
      }
      return PERMITIDO

    case 'cotizacion.eliminar':
      if (!esAdmin) return negar('Solo un administrador puede eliminar cotizaciones.')
      if (cerrada) {
        return negar('Una cotización ya enviada no se elimina; se cancela.')
      }
      return PERMITIDO

    case 'cotizacion.emitir':
      if (!esAdmin && !esComercial) {
        return negar('Tu rol es de solo lectura: no puedes emitir cotizaciones.')
      }
      if (cerrada) return negar('Esta cotización ya fue emitida.')
      if (!esAdmin && !esPropio) {
        return negar('Solo puedes emitir las cotizaciones que tú creaste.')
      }
      if (recurso.requiereAprobacion && !esAdmin && !actor.esAprobador) {
        return negar(
          'Esta cotización tiene ajustes que requieren aprobación antes de enviarse.',
        )
      }
      return PERMITIDO

    case 'cotizacion.aprobar':
      return esAdmin || actor.esAprobador
        ? PERMITIDO
        : negar('No tienes permiso para aprobar cotizaciones.')

    // ── Catálogo ───────────────────────────────────────────────────────
    case 'talento.editar':
    case 'tarifario.editar':
      return esAdmin || esComercial
        ? PERMITIDO
        : negar('Tu rol es de solo lectura: no puedes modificar el catálogo.')

    // ── Importación ────────────────────────────────────────────────────
    case 'importacion.subir':
      return esAdmin || esComercial
        ? PERMITIDO
        : negar('Tu rol es de solo lectura: no puedes importar archivos.')

    case 'importacion.aplicar':
      // Aplicar una importación reescribe el tarifario completo: se reserva a
      // administración aunque cualquiera con permiso pueda subir y revisar.
      return esAdmin
        ? PERMITIDO
        : negar('Solo un administrador puede aplicar una importación al tarifario.')

    // ── Administración ─────────────────────────────────────────────────
    case 'usuario.ver':
    case 'usuario.administrar':
    case 'ajustes.editar':
      return esAdmin ? PERMITIDO : negar('Solo un administrador puede hacer esto.')

    case 'bitacora.ver':
      return esAdmin || esComercial
        ? PERMITIDO
        : negar('Tu rol no tiene acceso a la bitácora.')

    default: {
      // Si se añade una acción y se olvida aquí, TypeScript falla la compilación
      // y en tiempo de ejecución se niega: nunca se abre por omisión.
      const _exhaustivo: never = accion
      return negar(`Acción desconocida: ${String(_exhaustivo)}`)
    }
  }
}

export class ForbiddenError extends Error {
  readonly accion: Accion
  constructor(accion: Accion, motivo: string) {
    super(motivo)
    this.name = 'ForbiddenError'
    this.accion = accion
  }
}

/** Igual que `can`, pero lanza. Es lo que se usa en el servidor. */
export function assertCan(
  actor: Actor | null,
  accion: Accion,
  recurso: Recurso = {},
): void {
  const d = can(actor, accion, recurso)
  if (!d.permitido) throw new ForbiddenError(accion, d.motivo)
}

/** Etiqueta del rol para la interfaz. */
export function etiquetaRol(rol: Rol): string {
  switch (rol) {
    case 'ADMIN':
      return 'Administrador'
    case 'COMERCIAL':
      return 'Comercial'
    case 'LECTURA':
      return 'Solo lectura'
  }
}
