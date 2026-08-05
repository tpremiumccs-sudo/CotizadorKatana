import 'server-only'
import { hash, verify } from '@node-rs/argon2'

/**
 * Hashing de contraseñas con argon2id.
 *
 * Parámetros: m=64 MiB, t=3, p=1. Es el mínimo que recomienda OWASP para
 * argon2id; con menos memoria el hash se vuelve barato de atacar en GPU, que es
 * justo lo que protege este sistema: tarifas y contactos de marcas.
 */
export const PARAMETROS_ARGON2 = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  algorithm: 2 as const, // argon2id
}

export async function hashPassword(plano: string): Promise<string> {
  return hash(plano, PARAMETROS_ARGON2)
}

/**
 * Verifica una contraseña.
 *
 * Devuelve `false` ante cualquier error en vez de propagarlo: un hash corrupto
 * en la base no debe distinguirse de una contraseña incorrecta, o se convierte
 * en un oráculo para quien pruebe credenciales.
 */
export async function verifyPassword(hashAlmacenado: string, plano: string): Promise<boolean> {
  try {
    return await verify(hashAlmacenado, plano, PARAMETROS_ARGON2)
  } catch {
    return false
  }
}

/**
 * ¿Hay que re-hashear tras un acceso correcto?
 *
 * `@node-rs/argon2` no expone `needsRehash`, así que se leen los parámetros del
 * propio hash en formato PHC:
 *   $argon2id$v=19$m=65536,t=3,p=1$<sal>$<hash>
 */
export function necesitaRehash(hashAlmacenado: string): boolean {
  const m = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hashAlmacenado)
  if (!m) return true // no es argon2id: hay que migrarlo

  const [, version, memoria, tiempo, paralelismo] = m
  return (
    Number(version) !== 19 ||
    Number(memoria) < PARAMETROS_ARGON2.memoryCost ||
    Number(tiempo) < PARAMETROS_ARGON2.timeCost ||
    Number(paralelismo) !== PARAMETROS_ARGON2.parallelism
  )
}

/**
 * Requisitos mínimos de contraseña.
 *
 * Longitud sobre complejidad: una frase larga resiste más que "P@ssw0rd!". Se
 * bloquean también las que contienen el nombre del sistema, que es lo primero
 * que prueba cualquiera.
 */
export function validarPassword(
  plano: string,
  contexto: { email?: string; nombre?: string } = {},
): { ok: true } | { ok: false; motivo: string } {
  if (plano.length < 12) {
    return { ok: false, motivo: 'La contraseña debe tener al menos 12 caracteres.' }
  }
  if (plano.length > 200) {
    return { ok: false, motivo: 'La contraseña es demasiado larga (máximo 200).' }
  }

  const n = plano.toLowerCase()
  const prohibidas = ['katana', 'cotizador', 'password', 'contrasena', '123456', 'qwerty']
  for (const p of prohibidas) {
    if (n.includes(p)) {
      return {
        ok: false,
        motivo: `La contraseña no puede contener "${p}". Usa una frase que solo tú conozcas.`,
      }
    }
  }

  const local = contexto.email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && n.includes(local)) {
    return { ok: false, motivo: 'La contraseña no puede contener tu correo.' }
  }
  if (contexto.nombre) {
    for (const parte of contexto.nombre.toLowerCase().split(/\s+/)) {
      if (parte.length >= 4 && n.includes(parte)) {
        return { ok: false, motivo: 'La contraseña no puede contener tu nombre.' }
      }
    }
  }

  return { ok: true }
}
