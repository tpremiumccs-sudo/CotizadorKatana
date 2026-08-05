import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Los dos .xlsx del CRM real.
 *
 * NO están en el repositorio: son el tarifario completo de la agencia (21
 * talentos × 19 formatos), el roster y las notas comerciales internas. Estuvo
 * versionado durante un tiempo con el repositorio en público, y sigue en el
 * historial de git; se dejó de versionar de aquí en adelante.
 *
 * Las pruebas que dependen de ellos se OMITEN cuando no están, en vez de fallar:
 * un colaborador sin acceso a los datos comerciales tiene que poder correr la
 * suite. Quien sí los tenga los deja en `tests/fixtures/xlsx/` —está en
 * `.gitignore`, así que no hay riesgo de volver a subirlos— y las pruebas
 * vuelven a correr solas.
 */

export const DIR_XLSX = join(import.meta.dirname, 'xlsx')

export const ARCHIVO_CRM = join(DIR_XLSX, 'KATANA_ENGINE_CRM_COMERCIAL_2026.xlsx')
export const ARCHIVO_ROSTER = join(DIR_XLSX, 'CRM_Roster_Katana_Actualizado.xlsx')

export const NOMBRE_CRM = 'KATANA_ENGINE_CRM_COMERCIAL_2026.xlsx'
export const NOMBRE_ROSTER = 'CRM_Roster_Katana_Actualizado.xlsx'

/** `true` cuando falta alguno de los dos, que es cuando hay que omitir. */
export const FALTAN_LOS_XLSX =
  !existsSync(ARCHIVO_CRM) || !existsSync(ARCHIVO_ROSTER)

let yaAvisado = false

/**
 * Dice en voz alta por qué se omitieron. Una prueba que desaparece sin decir
 * nada se confunde con una que pasa.
 */
export function avisarSiFaltan(): void {
  if (!FALTAN_LOS_XLSX || yaAvisado) return
  yaAvisado = true
  console.warn(
    `\n[pruebas] OMITIDAS: faltan los .xlsx del CRM en ${DIR_XLSX}\n` +
      `[pruebas]   ${NOMBRE_CRM}\n` +
      `[pruebas]   ${NOMBRE_ROSTER}\n` +
      '[pruebas] Son datos comerciales reales y no se versionan. Pídeselos a\n' +
      '[pruebas] Katana Talent y déjalos ahí; las pruebas vuelven a correr solas.\n',
  )
}
