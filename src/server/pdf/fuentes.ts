import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Fuentes y logo del documento, embebidos.
 *
 * Se cargan una vez y se sirven como base64 dentro del HTML. Así el documento
 * es autosuficiente: se ve igual en el servidor (Chromium dentro de Docker) y
 * en el iPad, sin depender de las fuentes que tenga instaladas el dispositivo,
 * y sin que la página pida nada por red.
 */

const DIR_FUENTES = join(process.cwd(), 'assets/fonts')
const DIR_MARCA = join(process.cwd(), 'assets/brand')

function leerBase64(ruta: string, ayuda: string): string {
  try {
    return readFileSync(ruta).toString('base64')
  } catch (e) {
    throw new Error(
      `No se pudo leer ${ruta}. ${ayuda} ` + (e instanceof Error ? e.message : ''),
    )
  }
}

let fuentesCache: { regularWoff2Base64: string; boldWoff2Base64: string } | null = null

export function fuentesDocumento(): {
  regularWoff2Base64: string
  boldWoff2Base64: string
} {
  fuentesCache ??= {
    regularWoff2Base64: leerBase64(
      join(DIR_FUENTES, 'KatanaSans-Regular.woff2'),
      'Es el subset de Nimbus Sans; sin él el documento no reproduce las métricas de Helvetica.',
    ),
    boldWoff2Base64: leerBase64(
      join(DIR_FUENTES, 'KatanaSans-Bold.woff2'),
      'Es el subset de Nimbus Sans en negrita.',
    ),
  }
  return fuentesCache
}

let logoCache: string | null = null

export function logoDataUri(): string {
  logoCache ??=
    'data:image/png;base64,' +
    leerBase64(join(DIR_MARCA, 'katana_logo.png'), 'Es el logo de Katana Talent.')
  return logoCache
}
