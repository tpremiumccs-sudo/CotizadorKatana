import 'server-only'
import { prisma } from '@/lib/db'

/**
 * Límite de intentos de acceso.
 *
 * Los intentos fallidos se registran en `IntentoAcceso`, una tabla barata y
 * purgable — NO en la bitácora. Un ataque de credential stuffing haría crecer
 * sin límite una tabla que es de solo inserción y que además se usa para
 * auditar de verdad.
 *
 * Se limita por correo y por IP a la vez: sólo por correo, quien tenga una lista
 * de usuarios bloquea a todo el equipo; sólo por IP, una oficina detrás de un
 * NAT se bloquea sola.
 */

const VENTANA_MINUTOS = 15
const MAX_POR_EMAIL = 8
const MAX_POR_IP = 30
const BLOQUEO_MINUTOS = 15

export interface ResultadoLimite {
  permitido: boolean
  /** Minutos que faltan para poder reintentar. */
  esperaMinutos?: number
  motivo?: string
}

export async function verificarLimite(
  email: string,
  ip: string | undefined,
): Promise<ResultadoLimite> {
  const desde = new Date(Date.now() - VENTANA_MINUTOS * 60_000)

  const usuario = await prisma.usuario.findUnique({
    where: { email },
    select: { bloqueadoHasta: true },
  })
  if (usuario?.bloqueadoHasta && usuario.bloqueadoHasta > new Date()) {
    const minutos = Math.ceil(
      (usuario.bloqueadoHasta.getTime() - Date.now()) / 60_000,
    )
    return {
      permitido: false,
      esperaMinutos: minutos,
      motivo: `Demasiados intentos. Vuelve a probar en ${minutos} minuto(s).`,
    }
  }

  const [porEmail, porIp] = await Promise.all([
    prisma.intentoAcceso.count({
      where: { email, exito: false, creadoEn: { gte: desde } },
    }),
    ip
      ? prisma.intentoAcceso.count({
          where: { ip, exito: false, creadoEn: { gte: desde } },
        })
      : Promise.resolve(0),
  ])

  if (porEmail >= MAX_POR_EMAIL) {
    return {
      permitido: false,
      esperaMinutos: BLOQUEO_MINUTOS,
      motivo: `Demasiados intentos con este correo. Espera ${BLOQUEO_MINUTOS} minutos.`,
    }
  }
  if (porIp >= MAX_POR_IP) {
    return {
      permitido: false,
      esperaMinutos: BLOQUEO_MINUTOS,
      motivo: `Demasiados intentos desde esta red. Espera ${BLOQUEO_MINUTOS} minutos.`,
    }
  }
  return { permitido: true }
}

export async function registrarIntento(
  email: string,
  ip: string | undefined,
  exito: boolean,
  motivo?: string,
): Promise<void> {
  await prisma.intentoAcceso.create({
    data: { email, ip: ip ?? null, exito, motivo: motivo ?? null },
  })

  if (exito) {
    // Un acceso correcto limpia el bloqueo y el historial de fallos.
    await prisma.usuario.updateMany({
      where: { email },
      data: { bloqueadoHasta: null, ultimoAccesoEn: new Date() },
    })
    await prisma.intentoAcceso.deleteMany({ where: { email, exito: false } })
    return
  }

  const desde = new Date(Date.now() - VENTANA_MINUTOS * 60_000)
  const fallos = await prisma.intentoAcceso.count({
    where: { email, exito: false, creadoEn: { gte: desde } },
  })
  if (fallos >= MAX_POR_EMAIL) {
    await prisma.usuario.updateMany({
      where: { email },
      data: { bloqueadoHasta: new Date(Date.now() + BLOQUEO_MINUTOS * 60_000) },
    })
  }
}

/** Purga los intentos viejos. La llama el arranque y el respaldo diario. */
export async function purgarIntentos(diasRetencion = 30): Promise<number> {
  const r = await prisma.intentoAcceso.deleteMany({
    where: { creadoEn: { lt: new Date(Date.now() - diasRetencion * 86_400_000) } },
  })
  return r.count
}

export const LIMITES = { VENTANA_MINUTOS, MAX_POR_EMAIL, MAX_POR_IP, BLOQUEO_MINUTOS }
