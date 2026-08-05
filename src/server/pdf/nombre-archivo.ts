/**
 * Nombre del archivo que se descarga.
 *
 * Importa más de lo que parece: el PDF acaba en un chat de WhatsApp junto a
 * otros veinte, y "Tabulador_HONOR_2026-08-05.pdf" se encuentra buscando
 * "HONOR" mientras que "documento.pdf" no se encuentra nunca.
 */

/** Quita acentos y todo lo que a un sistema de archivos no le sienta bien. */
function limpiar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export function nombreArchivo(opciones: {
  tipo: 'TABULADOR' | 'COTIZACION'
  cliente: string
  folio?: string | null
  fecha: Date
}): string {
  const clase = opciones.tipo === 'TABULADOR' ? 'Tabulador' : 'Cotizacion'
  const cliente = limpiar(opciones.cliente) || 'Cliente'
  // Fecha en ISO local: ordena bien alfabéticamente, que es como se ven los
  // archivos en el celular.
  const f = opciones.fecha
  const fecha = [
    f.getFullYear(),
    String(f.getMonth() + 1).padStart(2, '0'),
    String(f.getDate()).padStart(2, '0'),
  ].join('-')

  const folio = opciones.folio ? `_${limpiar(opciones.folio)}` : ''
  return `${clase}_${cliente}${folio}_${fecha}.pdf`
}
