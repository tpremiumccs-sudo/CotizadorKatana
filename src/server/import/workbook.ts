import 'server-only'
import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import type { RejillaHoja, ValorCelda } from './types'

/**
 * Lectura de archivos .xlsx.
 *
 * Devuelve rejillas de celdas sin interpretar nada: la interpretación vive en
 * los parsers, que sí se pueden probar sin abrir un archivo.
 *
 * Se usa ExcelJS y no SheetJS porque la versión de SheetJS publicada en npm
 * está congelada y arrastra vulnerabilidades conocidas de contaminación de
 * prototipo, y estos archivos los sube un humano por la red.
 */

/** Un CRM de una agencia no llega a esto ni de lejos; frena una subida hostil. */
export const MAX_BYTES = 25 * 1024 * 1024

export class ArchivoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ArchivoInvalidoError'
  }
}

function valorDeCelda(celda: ExcelJS.Cell): ValorCelda {
  const v = celda.value

  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v

  if (typeof v === 'object') {
    // Celda con fórmula: interesa el resultado calculado, no la fórmula.
    //
    // Si el libro se guardó sin resultados en caché, `result` no existe. Hay
    // que devolver null: caer en `String(v)` produciría "[object Object]", que
    // parece un dato y se cuela como texto en la columna. Eso llegó a hacer
    // que 12 de 16 talentos del roster desaparecieran de la importación.
    if ('formula' in v || 'sharedFormula' in v) {
      const r = 'result' in v ? v.result : undefined
      if (r === null || r === undefined) return null
      if (typeof r === 'string' || typeof r === 'number' || typeof r === 'boolean') return r
      if (r instanceof Date) return r
      return null // error de fórmula (#REF!, #N/A…)
    }
    // Texto enriquecido: se concatenan los fragmentos.
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text).join('')
    }
    // Celda con hipervínculo: se conserva el texto visible.
    if ('text' in v && typeof v.text === 'string') return v.text
    if ('error' in v) return null
    // Cualquier otra forma que ExcelJS pueda devolver: mejor vacío que basura.
    return null
  }
  return String(v)
}

export function sha256(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

export async function readWorkbook(buf: Buffer): Promise<RejillaHoja[]> {
  if (buf.byteLength === 0) {
    throw new ArchivoInvalidoError('El archivo está vacío.')
  }
  if (buf.byteLength > MAX_BYTES) {
    throw new ArchivoInvalidoError(
      `El archivo pesa ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB y el máximo son ` +
        `${MAX_BYTES / 1024 / 1024} MB.`,
    )
  }

  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer)
  } catch (e) {
    throw new ArchivoInvalidoError(
      'No se pudo abrir el archivo. ¿Es un .xlsx válido? ' +
        (e instanceof Error ? e.message : ''),
    )
  }

  const hojas: RejillaHoja[] = []
  wb.eachSheet((ws) => {
    const filas: ValorCelda[][] = []
    // `includeEmpty` mantiene la alineación de columnas: sin él, una celda
    // vacía en medio correría los índices y el mapeo de encabezados fallaría.
    ws.eachRow({ includeEmpty: true }, (row) => {
      const fila: ValorCelda[] = []
      row.eachCell({ includeEmpty: true }, (cell) => {
        fila.push(valorDeCelda(cell))
      })
      filas.push(fila)
    })
    hojas.push({ nombre: ws.name, filas })
  })

  if (hojas.length === 0) {
    throw new ArchivoInvalidoError('El archivo no tiene hojas.')
  }
  return hojas
}

export function buscarHoja(
  hojas: readonly RejillaHoja[],
  nombre: string,
): RejillaHoja | undefined {
  const objetivo = normalizarNombreHoja(nombre)
  return hojas.find((h) => normalizarNombreHoja(h.nombre) === objetivo)
}

/** Los nombres de hoja traen guiones largos y acentos que se escriben distinto. */
function normalizarNombreHoja(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Detecta cuál de los dos archivos del CRM es, por las hojas que contiene.
 * Así el usuario puede subir cualquiera de los dos sin elegir el tipo a mano.
 */
export function detectarTipoArchivo(
  hojas: readonly RejillaHoja[],
): 'CRM_COMERCIAL' | 'ROSTER' | null {
  const nombres = new Set(hojas.map((h) => normalizarNombreHoja(h.nombre)))
  if (nombres.has(normalizarNombreHoja('TARIFARIO KATANA'))) return 'CRM_COMERCIAL'
  if (nombres.has(normalizarNombreHoja('Base de Talentos'))) return 'ROSTER'
  if (nombres.has(normalizarNombreHoja('KIF — Base de Talentos'))) return 'ROSTER'
  return null
}
