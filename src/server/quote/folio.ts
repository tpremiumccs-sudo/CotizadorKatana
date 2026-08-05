import type { Prisma } from '@prisma/client'

/**
 * Folios de cotización: `KAT-{CÓDIGO}-{AÑO}-{CONSECUTIVO}`.
 *
 * El formato sale del registro real de la agencia (hoja PROPUESTAS KATANA
 * ENGINE): KAT-VPV-2026-001, KAT-HON-2026-001, KAT-NFX-2026-001,
 * KAT-UFC-2026-001, KAT-PLR-2026-001, KAT-VDS-2026-001, KAT-RON-2026-001,
 * KAT-AZT-2026-001.
 *
 * Nótese que los códigos NO son derivables de forma mecánica: Netflix es NFX y
 * no NET, Viajes Lili es VDS, The Player es PLR. Por eso el código del cliente
 * se **sugiere** al crearlo y queda editable, y al importar el histórico se
 * **parsea** del folio existente en vez de recalcularse.
 */

export const RE_FOLIO = /^KAT-([A-Z0-9]{3})-(\d{4})-(\d{3,})$/

export interface FolioPartes {
  folioCode: string
  year: number
  seq: number
}

export function formatearFolio(partes: FolioPartes): string {
  const seq = String(partes.seq).padStart(3, '0')
  return `KAT-${partes.folioCode}-${partes.year}-${seq}`
}

export function parsearFolio(folio: string): FolioPartes | null {
  const m = RE_FOLIO.exec(folio.trim().toUpperCase())
  if (!m) return null
  return { folioCode: m[1]!, year: Number(m[2]), seq: Number(m[3]) }
}

/** Palabras que no aportan identidad al código de cliente. */
const VACIAS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'the', 'of', 'and',
  'sa', 'sab', 'cv', 'sc', 'srl', 'inc', 'llc', 'ltd', 'co', 'corp', 'group',
  'grupo', 'mexico', 'méxico', 'mx',
])

function sinDiacriticos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Sugiere un código de 3 caracteres para un cliente nuevo.
 *
 * Es una sugerencia, no una regla: el usuario la puede cambiar y los códigos
 * históricos se respetan tal cual. `ocupados` evita colisiones, ya que el
 * código es único por cliente.
 */
export function sugerirFolioCode(
  nombre: string,
  ocupados: ReadonlySet<string> = new Set(),
): string {
  const limpio = sinDiacriticos(nombre)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()

  const palabras = limpio
    .split(/\s+/)
    .filter((p) => p.length > 0 && !VACIAS.has(p.toLowerCase()))

  const candidatos: string[] = []

  if (palabras.length >= 3) {
    candidatos.push(palabras.slice(0, 3).map((p) => p[0]!).join(''))
  }
  if (palabras.length === 2) {
    candidatos.push(palabras[0]![0]! + palabras[1]!.slice(0, 2))
    candidatos.push(palabras[0]!.slice(0, 2) + palabras[1]![0]!)
  }
  if (palabras.length >= 1) {
    const p = palabras[0]!
    candidatos.push(p.slice(0, 3))
    // Iniciales + consonantes: "NETFLIX" → "NTF", parecido a cómo se eligió NFX.
    const consonantes = p[0]! + p.slice(1).replace(/[AEIOU0-9]/g, '')
    candidatos.push(consonantes.slice(0, 3))
  }

  for (const c of candidatos) {
    const cod = c.padEnd(3, 'X').slice(0, 3)
    if (cod.length === 3 && !ocupados.has(cod)) return cod
  }

  // Todo ocupado: se numera hasta encontrar hueco.
  const raiz = (palabras[0] ?? 'CLI').slice(0, 2).padEnd(2, 'X')
  for (let i = 0; i < 10; i++) {
    const cod = raiz + String(i)
    if (!ocupados.has(cod)) return cod
  }
  for (let i = 0; i < 1000; i++) {
    const cod = 'C' + String(i).padStart(2, '0')
    if (!ocupados.has(cod)) return cod
  }
  throw new Error('No hay códigos de folio disponibles.')
}

/**
 * Reserva el siguiente consecutivo para (cliente, año) de forma atómica.
 *
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` resuelve la carrera dentro de
 * Postgres: dos usuarios emitiendo a la vez para el mismo cliente obtienen
 * consecutivos distintos sin lock explícito ni reintentos. Un `SELECT` seguido
 * de `UPDATE` sí podría dar el mismo folio a los dos.
 *
 * Debe llamarse DENTRO de la transacción que emite la cotización: si la
 * emisión falla, el consecutivo se devuelve con el rollback.
 */
export async function reservarFolio(
  tx: Prisma.TransactionClient,
  folioCode: string,
  year: number,
): Promise<FolioPartes> {
  const code = folioCode.trim().toUpperCase()
  if (!/^[A-Z0-9]{3}$/.test(code)) {
    throw new Error(`Código de folio inválido: ${folioCode!}`)
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    throw new Error(`Año de folio inválido: ${year}`)
  }

  const scope = `${code}-${year}`
  const filas = await tx.$queryRaw<{ lastSeq: number }[]>`
    INSERT INTO "FolioCounter" ("scope", "lastSeq", "actualizadoEn")
    VALUES (${scope}, 1, now())
    ON CONFLICT ("scope") DO UPDATE
      SET "lastSeq" = "FolioCounter"."lastSeq" + 1,
          "actualizadoEn" = now()
    RETURNING "lastSeq"
  `
  const seq = filas[0]?.lastSeq
  if (seq == null) {
    throw new Error(`No se pudo reservar folio para ${scope}.`)
  }
  return { folioCode: code, year, seq }
}

/**
 * Alinea el contador con folios que ya existían antes del sistema.
 *
 * Al importar el histórico de PROPUESTAS KATANA ENGINE hay folios ya emitidos;
 * sin esto, la primera cotización nueva de HONOR repetiría KAT-HON-2026-001.
 * Sólo sube el contador, nunca lo baja.
 */
export async function sincronizarContador(
  tx: Prisma.TransactionClient,
  partes: FolioPartes,
): Promise<void> {
  const scope = `${partes.folioCode}-${partes.year}`
  await tx.$executeRaw`
    INSERT INTO "FolioCounter" ("scope", "lastSeq", "actualizadoEn")
    VALUES (${scope}, ${partes.seq}, now())
    ON CONFLICT ("scope") DO UPDATE
      SET "lastSeq" = GREATEST("FolioCounter"."lastSeq", ${partes.seq}),
          "actualizadoEn" = now()
  `
}
