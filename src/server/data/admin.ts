import 'server-only'
import { prisma } from '@/lib/db'
import { append } from '@/server/audit/append'
import { autorizar } from '@/server/data/autorizar'
import { hashPassword, validarPassword } from '@/server/auth/password'
import { revocarSesionesDe } from '@/server/auth/session'
import { etiquetaRol, type Rol } from '@/lib/authz/policy'
import type { CategoriaBitacora } from '@/server/audit/append'

/** Administración de usuarios y consulta de la bitácora. */

export type EstadoUsuario = 'ACTIVO' | 'SUSPENDIDO' | 'DESACTIVADO'

export async function listarUsuarios() {
  await autorizar('usuario.ver')
  const usuarios = await prisma.usuario.findMany({
    orderBy: [{ estado: 'asc' }, { nombre: 'asc' }],
    select: {
      id: true, email: true, nombre: true, rol: true, estado: true,
      esAprobador: true, debeCambiarPassword: true, ultimoAccesoEn: true,
      bloqueadoHasta: true, creadoEn: true,
      _count: { select: { sesiones: { where: { revocadaEn: null } } } },
    },
  })
  return usuarios.map((u) => ({
    ...u,
    sesionesAbiertas: u._count.sesiones,
    bloqueado: u.bloqueadoHasta !== null && u.bloqueadoHasta > new Date(),
  }))
}

export interface NuevoUsuario {
  email: string
  nombre: string
  rol: Rol
  esAprobador: boolean
  passwordInicial: string
}

/**
 * Da de alta a alguien.
 *
 * La contraseña la pone un administrador y el sistema OBLIGA a cambiarla en el
 * primer acceso: nadie más que la persona debe conocer la suya, y una
 * contraseña dictada por WhatsApp no cumple eso.
 */
export async function crearUsuario(datos: NuevoUsuario) {
  const actor = await autorizar('usuario.administrar')

  const email = datos.email.trim().toLowerCase()
  const nombre = datos.nombre.trim()
  if (!email || !nombre) throw new Error('Hacen falta el correo y el nombre.')

  const validacion = validarPassword(datos.passwordInicial, { email, nombre })
  if (!validacion.ok) throw new Error(validacion.motivo)

  const existente = await prisma.usuario.findUnique({ where: { email } })
  if (existente) throw new Error(`Ya hay una cuenta con el correo ${email}.`)

  const passwordHash = await hashPassword(datos.passwordInicial)

  return prisma.$transaction(async (tx) => {
    const u = await tx.usuario.create({
      data: {
        email, nombre, rol: datos.rol, estado: 'ACTIVO',
        esAprobador: datos.esAprobador, passwordHash,
        debeCambiarPassword: true,
      },
      select: { id: true, email: true, nombre: true, rol: true },
    })

    await append(tx, {
      actor,
      categoria: 'USUARIOS',
      accion: 'usuario.creado',
      entidadTipo: 'Usuario',
      entidadId: u.id,
      entidadEtiqueta: u.email,
      resumen: `${actor.nombre} dio de alta a ${nombre} (${etiquetaRol(datos.rol)}).`,
    })

    return u
  })
}

export interface CambioUsuario {
  usuarioId: string
  rol?: Rol
  estado?: EstadoUsuario
  esAprobador?: boolean
}

/**
 * Cambia rol, estado o facultad de aprobar.
 *
 * Bajar un rol o suspender una cuenta REVOCA sus sesiones en el acto: si
 * alguien pasa de Comercial a Lectura, sus pestañas abiertas no pueden seguir
 * editando hasta que se le ocurra recargar.
 */
export async function actualizarUsuario(cambio: CambioUsuario) {
  const actor = await autorizar('usuario.administrar', {
    entidadTipo: 'Usuario',
    entidadId: cambio.usuarioId,
  })

  const previo = await prisma.usuario.findUnique({ where: { id: cambio.usuarioId } })
  if (!previo) throw new Error('Esa cuenta ya no existe.')

  // Quedarse sin ningún administrador activo deja el sistema sin quien pueda
  // arreglarlo. Se impide antes de tocar nada.
  const dejaDeSerAdmin =
    (cambio.rol !== undefined && previo.rol === 'ADMIN' && cambio.rol !== 'ADMIN') ||
    (cambio.estado !== undefined && previo.rol === 'ADMIN' && cambio.estado !== 'ACTIVO')
  if (dejaDeSerAdmin) {
    const otros = await prisma.usuario.count({
      where: { rol: 'ADMIN', estado: 'ACTIVO', id: { not: previo.id } },
    })
    if (otros === 0) {
      throw new Error(
        'Es el único administrador activo. Nombra a otro antes de cambiar esta cuenta, ' +
          'o nadie podrá volver a administrar el sistema.',
      )
    }
  }

  const cambios: Record<string, { antes: unknown; despues: unknown }> = {}
  if (cambio.rol !== undefined && cambio.rol !== previo.rol) {
    cambios.rol = { antes: etiquetaRol(previo.rol), despues: etiquetaRol(cambio.rol) }
  }
  if (cambio.estado !== undefined && cambio.estado !== previo.estado) {
    cambios.estado = { antes: previo.estado, despues: cambio.estado }
  }
  if (cambio.esAprobador !== undefined && cambio.esAprobador !== previo.esAprobador) {
    cambios.aprobador = { antes: previo.esAprobador, despues: cambio.esAprobador }
  }
  if (Object.keys(cambios).length === 0) return { revocadas: 0 }

  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id: cambio.usuarioId },
      data: {
        ...(cambio.rol !== undefined ? { rol: cambio.rol } : {}),
        ...(cambio.estado !== undefined ? { estado: cambio.estado } : {}),
        ...(cambio.esAprobador !== undefined
          ? { esAprobador: cambio.esAprobador }
          : {}),
      },
    })

    await append(tx, {
      actor,
      categoria: 'USUARIOS',
      accion: 'usuario.modificado',
      entidadTipo: 'Usuario',
      entidadId: previo.id,
      entidadEtiqueta: previo.email,
      resumen:
        `${actor.nombre} cambió la cuenta de ${previo.nombre}: ` +
        Object.entries(cambios)
          .map(([k, v]) => `${k} de ${v.antes} a ${v.despues}`)
          .join(', ') +
        '.',
      cambios,
    })
  })

  // Fuera de la transacción a propósito: revocar es idempotente y no debe poder
  // deshacer el cambio de rol si algo falla al final.
  const necesitaRevocar =
    cambios.rol !== undefined ||
    (cambio.estado !== undefined && cambio.estado !== 'ACTIVO')
  const revocadas = necesitaRevocar
    ? await revocarSesionesDe(previo.id, 'cambio de rol o de estado')
    : 0

  return { revocadas }
}

/** Fuerza a cambiar la contraseña en el próximo acceso. */
export async function reiniciarPassword(usuarioId: string, passwordNueva: string) {
  const actor = await autorizar('usuario.administrar', {
    entidadTipo: 'Usuario',
    entidadId: usuarioId,
  })

  const previo = await prisma.usuario.findUnique({ where: { id: usuarioId } })
  if (!previo) throw new Error('Esa cuenta ya no existe.')

  const validacion = validarPassword(passwordNueva, {
    email: previo.email, nombre: previo.nombre,
  })
  if (!validacion.ok) throw new Error(validacion.motivo)

  await prisma.usuario.update({
    where: { id: usuarioId },
    data: {
      passwordHash: await hashPassword(passwordNueva),
      debeCambiarPassword: true,
      bloqueadoHasta: null,
    },
  })
  await prisma.intentoAcceso.deleteMany({ where: { email: previo.email, exito: false } })
  const revocadas = await revocarSesionesDe(usuarioId, 'contraseña reiniciada')

  await prisma.$transaction(async (tx) => {
    await append(tx, {
      actor,
      categoria: 'USUARIOS',
      accion: 'usuario.password_reiniciada',
      entidadTipo: 'Usuario',
      entidadId: usuarioId,
      entidadEtiqueta: previo.email,
      resumen:
        `${actor.nombre} reinició la contraseña de ${previo.nombre}. ` +
        `Se cerraron ${revocadas} sesión(es) y tendrá que elegir una nueva al entrar.`,
    })
  })

  return { revocadas }
}

// ─────────────────────────────── Bitácora ──────────────────────────────

export interface FiltroBitacora {
  categoria?: CategoriaBitacora
  actorEmail?: string
  texto?: string
  soloFallidos?: boolean
  limite?: number
  desdeId?: string
}

export async function leerBitacora(filtro: FiltroBitacora = {}) {
  await autorizar('bitacora.ver')
  const limite = Math.min(filtro.limite ?? 100, 300)

  const eventos = await prisma.bitacora.findMany({
    take: limite + 1,
    ...(filtro.desdeId ? { skip: 1, cursor: { id: filtro.desdeId } } : {}),
    orderBy: { ocurridoEn: 'desc' },
    where: {
      ...(filtro.categoria ? { categoria: filtro.categoria } : {}),
      ...(filtro.actorEmail ? { actorEmail: filtro.actorEmail } : {}),
      ...(filtro.soloFallidos ? { exito: false } : {}),
      ...(filtro.texto
        ? {
            OR: [
              { resumen: { contains: filtro.texto, mode: 'insensitive' as const } },
              {
                entidadEtiqueta: {
                  contains: filtro.texto, mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true, ocurridoEn: true, categoria: true, accion: true,
      actorNombre: true, actorEmail: true, actorRol: true,
      entidadTipo: true, entidadEtiqueta: true, resumen: true,
      cambios: true, exito: true, ip: true,
    },
  })

  return {
    eventos: eventos.slice(0, limite),
    hayMas: eventos.length > limite,
  }
}

/** Quiénes han hecho algo, para el filtro por persona. */
export async function actoresDeBitacora() {
  await autorizar('bitacora.ver')
  const filas = await prisma.bitacora.groupBy({
    by: ['actorEmail', 'actorNombre'],
    _count: { _all: true },
    orderBy: { _count: { actorEmail: 'desc' } },
    take: 30,
  })
  return filas
    .filter((f) => f.actorEmail !== null)
    .map((f) => ({
      email: f.actorEmail!,
      nombre: f.actorNombre ?? f.actorEmail!,
      eventos: f._count._all,
    }))
}
