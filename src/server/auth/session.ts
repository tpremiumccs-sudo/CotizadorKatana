import 'server-only'
import { cache } from 'react'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import type { Actor } from '@/lib/authz/policy'

/**
 * Sesiones propias, opacas, guardadas en Postgres.
 *
 * Se descartó Auth.js: con el proveedor de credenciales obliga a sesiones JWT,
 * que NO se pueden revocar — si alguien deja la agencia, su token sigue siendo
 * válido hasta que expire. Un sistema con roles y bitácora necesita poder
 * cerrar una sesión de verdad, así que la sesión vive en la base y se puede
 * matar al instante.
 *
 * En la base sólo se guarda el sha256 del token: si alguien lee la tabla, no
 * obtiene sesiones utilizables.
 */

/**
 * El prefijo `__Host-` ata la cookie al host exacto y EXIGE `secure`, lo que
 * impide que un subdominio comprometido la sobrescriba. En desarrollo sobre
 * http no se puede usar, así que ahí cae a un nombre normal.
 */
const NOMBRE_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-katana_sesion' : 'katana_sesion'
const BYTES_TOKEN = 32

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function nuevoToken(): string {
  return randomBytes(BYTES_TOKEN).toString('base64url')
}

export interface DatosSesion {
  actor: Actor
  sesionId: string
  debeCambiarPassword: boolean
}

/** Crea la sesión y deja la cookie puesta. */
export async function crearSesion(
  usuarioId: string,
  opciones: { recordar?: boolean; ip?: string; userAgent?: string } = {},
): Promise<string> {
  const token = nuevoToken()
  const ahora = Date.now()

  // Expiración deslizante (se renueva con el uso) y un tope absoluto que no se
  // renueva nunca: una sesión olvidada en un iPad no dura para siempre.
  const horasDeslizante = opciones.recordar
    ? env.SESSION_SLIDING_HOURS * 2
    : env.SESSION_SLIDING_HOURS
  const expiraEn = new Date(ahora + horasDeslizante * 3_600_000)
  const expiraAbsolutoEn = new Date(ahora + env.SESSION_ABSOLUTE_HOURS * 3_600_000)

  const sesion = await prisma.sesion.create({
    data: {
      tokenHash: hashToken(token),
      usuarioId,
      expiraEn,
      expiraAbsolutoEn,
      recordar: opciones.recordar ?? false,
      ip: opciones.ip ?? null,
      userAgent: opciones.userAgent?.slice(0, 500) ?? null,
      reautenticadoEn: new Date(),
    },
  })

  const store = await cookies()
  store.set(NOMBRE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiraAbsolutoEn,
  })

  return sesion.id
}

/**
 * Lee la sesión de la cookie y la renueva si sigue viva.
 *
 * Va envuelta en `cache()` de React: una misma petición la consulta desde el
 * layout, desde la página y desde cada acción, y sin esto serían tres consultas
 * —y hasta tres UPDATE de renovación— para responder lo mismo. La caché dura lo
 * que dura la petición, así que nunca sirve la sesión de otro usuario.
 */
export const leerSesion = cache(async function leerSesion(): Promise<DatosSesion | null> {
  const store = await cookies()
  const token = store.get(NOMBRE_COOKIE)?.value
  if (!token) return null

  const sesion = await prisma.sesion.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { usuario: true },
  })
  if (!sesion) return null

  const ahora = new Date()
  if (
    sesion.revocadaEn !== null ||
    sesion.expiraEn < ahora ||
    sesion.expiraAbsolutoEn < ahora
  ) {
    return null
  }

  const u = sesion.usuario
  if (u.estado !== 'ACTIVO') return null

  // Renovación deslizante, pero sólo si pasó un rato: escribir en cada petición
  // convertiría cada carga de página en un UPDATE.
  const minutosDesdeActividad =
    (ahora.getTime() - sesion.ultimaActividadEn.getTime()) / 60_000
  if (minutosDesdeActividad > 5) {
    const nuevaExpiracion = new Date(
      ahora.getTime() + env.SESSION_SLIDING_HOURS * 3_600_000,
    )
    await prisma.sesion.update({
      where: { id: sesion.id },
      data: {
        ultimaActividadEn: ahora,
        // Nunca más allá del tope absoluto.
        expiraEn:
          nuevaExpiracion < sesion.expiraAbsolutoEn
            ? nuevaExpiracion
            : sesion.expiraAbsolutoEn,
      },
    })
  }

  return {
    sesionId: sesion.id,
    debeCambiarPassword: u.debeCambiarPassword,
    actor: {
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      estado: u.estado,
      esAprobador: u.esAprobador,
    },
  }
})

/** Cierra la sesión actual. */
export async function cerrarSesion(motivo = 'cierre voluntario'): Promise<void> {
  const store = await cookies()
  const token = store.get(NOMBRE_COOKIE)?.value
  if (token) {
    await prisma.sesion.updateMany({
      where: { tokenHash: hashToken(token), revocadaEn: null },
      data: { revocadaEn: new Date(), motivoRevocacion: motivo },
    })
  }
  store.delete(NOMBRE_COOKIE)
}

/**
 * Revoca TODAS las sesiones de un usuario.
 *
 * Se usa al cambiar la contraseña, al suspender una cuenta y al cambiar un rol:
 * si alguien pasa de Comercial a Lectura, sus pestañas abiertas no deben seguir
 * pudiendo editar.
 */
export async function revocarSesionesDe(
  usuarioId: string,
  motivo: string,
): Promise<number> {
  const r = await prisma.sesion.updateMany({
    where: { usuarioId, revocadaEn: null },
    data: { revocadaEn: new Date(), motivoRevocacion: motivo },
  })
  return r.count
}

/** Datos de la petición para la bitácora. */
export async function contextoPeticion(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers()
  // Detrás de Cloudflare Tunnel la IP real viene en estas cabeceras.
  const ip =
    h.get('cf-connecting-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    undefined
  return { ip, userAgent: h.get('user-agent') ?? undefined }
}

/** Comparación en tiempo constante, para tokens de invitación y de reseteo. */
export function comparaSegura(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export { NOMBRE_COOKIE, hashToken, nuevoToken }
