import 'server-only'
import { prisma } from '@/lib/db'
import { append, type EventoBitacora } from '@/server/audit/append'
import type { Actor } from '@/lib/authz/policy'

/**
 * Consultas de usuario de la capa de datos.
 *
 * Las acciones de servidor NO tocan Prisma: todo pasa por aquí, que es donde
 * se decide qué columnas salen. En particular `passwordHash` nunca sale de
 * este archivo — se compara adentro y lo que se devuelve es un booleano.
 */

/** Lo que la app conoce de un usuario. Sin hash, sin campos internos. */
export interface UsuarioBasico {
  id: string
  email: string
  nombre: string
  rol: Actor['rol']
  estado: Actor['estado']
  esAprobador: boolean
  debeCambiarPassword: boolean
}

const CAMPOS_BASICOS = {
  id: true, email: true, nombre: true, rol: true,
  estado: true, esAprobador: true, debeCambiarPassword: true,
} as const

export function comoActor(u: UsuarioBasico): Actor {
  return {
    id: u.id, nombre: u.nombre, email: u.email,
    rol: u.rol, estado: u.estado, esAprobador: u.esAprobador,
  }
}

/**
 * Credencial de acceso: usuario + su hash.
 *
 * Es el único punto que expone el hash, y se usa exclusivamente en el flujo de
 * acceso, donde hace falta verificarlo *y* saber si hay que re-hashearlo.
 */
export interface Credencial {
  usuario: UsuarioBasico
  passwordHash: string | null
}

export async function credencialPorEmail(email: string): Promise<Credencial | null> {
  const u = await prisma.usuario.findUnique({
    where: { email },
    select: { ...CAMPOS_BASICOS, passwordHash: true },
  })
  if (!u) return null
  const { passwordHash, ...basico } = u
  return { usuario: basico, passwordHash }
}

export async function credencialPorId(id: string): Promise<Credencial | null> {
  const u = await prisma.usuario.findUnique({
    where: { id },
    select: { ...CAMPOS_BASICOS, passwordHash: true },
  })
  if (!u) return null
  const { passwordHash, ...basico } = u
  return { usuario: basico, passwordHash }
}

/** Reemplaza el hash sin tocar nada más (re-hash por parámetros nuevos). */
export async function actualizarHash(id: string, passwordHash: string): Promise<void> {
  await prisma.usuario.update({ where: { id }, data: { passwordHash } })
}

/** Contraseña nueva elegida por el propio usuario: limpia la marca de cambio obligatorio. */
export async function establecerPassword(
  id: string,
  passwordHash: string,
): Promise<void> {
  await prisma.usuario.update({
    where: { id },
    data: {
      passwordHash,
      passwordCambiadoEn: new Date(),
      debeCambiarPassword: false,
    },
  })
}

/**
 * Registra un evento suelto en la bitácora.
 *
 * `append` exige una transacción a propósito: un cambio y su registro se
 * confirman juntos o no se confirman. Los eventos de autenticación son la
 * excepción — no acompañan a ningún cambio de datos — así que abren la suya.
 */
export async function registrarEvento(evento: EventoBitacora): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await append(tx, evento)
  })
}
