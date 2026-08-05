import type { DocumentoTabulador } from '@/lib/doc/tipos'

/**
 * Los datos exactos del tabulador de HONOR.
 *
 * Reproducen el PDF que la agencia envió de verdad. Nótese que TRES de los
 * precios de Mariel Estrella y los espejos de Ronny y Tony **no** coinciden con
 * el tarifario maestro: se ajustaron para esta cotización. Es la evidencia de
 * que los ajustes por documento son la norma, y es justo lo que esta prueba
 * verifica que el sistema puede reproducir.
 *
 *   Mariel · Reel IG    tarifario: Pendiente   → documento: $120,000
 *   Mariel · Espejo     tarifario: Pendiente   → documento: $150,000
 *   Mariel · Story      tarifario: Pendiente   → documento:  $40,000
 *   Ronny  · Espejo     tarifario: $195,000    → documento: $150,000
 *   Tony   · Espejo     tarifario:  $90,000    → documento:  $80,000
 */

const P = (pesos: number) => ({ amountCents: pesos * 100, status: 'QUOTED' as const })

export function documentoHonor(logoDataUri: string): DocumentoTabulador {
  return {
    tipo: 'TABULADOR',
    eyebrow: 'KATANA TALENT',
    titulo: 'Tabulador de Tarifas',
    cliente: 'HONOR',
    meta: [
      { etiqueta: 'CLIENTE', valor: 'HONOR' },
      { etiqueta: 'CONTACTO', valor: 'Fer Nicolini' },
      { etiqueta: 'AGENTE', valor: 'Chuy Gallardo' },
      { etiqueta: 'MONEDA', valor: 'MXN' },
    ],
    columnas: [
      { label: 'TIKTOK' },
      { label: 'REEL (IG)' },
      { label: 'TIKTOK + REEL', sublabel: '(ESPEJO)' },
      { label: 'STORY (IG)' },
    ],
    // Centros medidos en el PDF original: 60, 88, 119 y 151 mm desde el borde
    // de la caja. No es un reparto uniforme; se ajustaron a mano.
    centrosColumna: [240.803, 320.173, 408.047, 498.756],
    filas: [
      {
        nombre: 'Mariel Estrella',
        celdas: [P(100_000), { ...P(120_000), ajustado: true }, { ...P(150_000), ajustado: true }, { ...P(40_000), ajustado: true }],
      },
      {
        nombre: 'Tony Gastélum',
        celdas: [P(30_000), P(60_000), { ...P(80_000), ajustado: true }, P(25_000)],
      },
      {
        nombre: 'Yoiker',
        celdas: [P(25_000), P(40_000), P(60_000), P(20_000)],
      },
      {
        nombre: 'Ronny',
        celdas: [P(90_000), P(130_000), { ...P(150_000), ajustado: true }, P(40_000)],
      },
    ],
    tituloConsideraciones: 'Consideraciones',
    consideraciones: [
      'Tarifas expresadas en pesos mexicanos (MXN).',
      'No incluyen IVA.',
      'No incluyen producción.',
      'No incluyen viáticos.',
      'No incluyen derechos de uso de imagen.',
      'No incluyen pauta digital (whitelisting).',
      'No incluyen exclusividad.',
      'Sujetas a disponibilidad del talento.',
      'Sujetas a confirmación y aprobación final por Katana Talent.',
    ],
    tituloTerminos: 'Términos y Condiciones',
    terminos: [
      'Vigencia de este tabulador: 15 días naturales a partir de la fecha de envío.',
      'Los precios podrán actualizarse sin previo aviso una vez concluida la vigencia.',
      'La confirmación de talento, fechas y entregables está sujeta a disponibilidad al momento de la solicitud.',
      'Toda campaña incluye hasta dos (2) rondas de cambios sobre el alcance aprobado; cada ronda adicional tendrá un costo equivalente al 10% del valor del entregable afectado.',
      'Producción, viáticos, hospedaje, traslados, derechos adicionales, pauta y exclusividad se cotizan por separado, salvo que se indiquen expresamente como incluidos.',
      'El pago y forma de facturación se definen en la orden de compra o contrato correspondiente a cada proyecto.',
      'Esta cotización es de carácter informativo y no representa una confirmación de talento hasta contar con aprobación comercial de Katana Talent.',
    ],
    confidencialidadTitulo: 'Confidencialidad.',
    confidencialidadTexto:
      'La información de este documento —tarifas, contactos y condiciones comerciales— es ' +
      'confidencial entre Katana Talent y {CLIENTE}, y no podrá compartirse con terceros sin ' +
      'autorización previa.',
    firma:
      'Katana Talent · Representación · Influencer Marketing · Sports & Entertainment · ' +
      'chuygallardo@katanatalent.com',
    piePagina: 'Katana Talent  ·  Información confidencial',
    logoDataUri,
    textoPendiente: 'Cotizar',
    textoCasoPorCaso: 'Cotizar',
    textoNoAplica: 'No aplica',
    textoVacio: '—',
    preciosEnMorado: false,
  }
}
