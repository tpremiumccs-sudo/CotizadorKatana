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
 * La política vive en `src/lib/politica-password.ts`, sin `server-only`, para
 * que el seed pueda aplicarla también: es la única forma de que el primer
 * administrador no nazca con una credencial que el propio sistema prohíbe.
 * Se reexporta aquí para no romper a quien ya la importaba de este módulo.
 */
export { validarPassword } from '@/lib/politica-password'
