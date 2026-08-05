/**
 * Catálogo de formatos cotizables.
 *
 * Son las 19 columnas de precio de la hoja TARIFARIO KATANA. `excelHeader` es
 * el encabezado EXACTO del archivo y es la clave de importación: si cambia en
 * el Excel, el importador lo reporta como columna sin mapear en vez de perder
 * la tarifa en silencio.
 *
 * Las otras cuatro columnas de esa hoja NO son formatos y no se cotizan:
 *   Plataforma principal → nota de texto del talento
 *   Estado               → estatus del tarifario
 *   Notas                → nota íntegra (la de Padigol trae un tarifario en prosa)
 *   Fuente / fecha       → procedencia del dato
 *
 * `pdfLabel` y `pdfSublabel` son lo que se imprime. El tabulador de HONOR
 * renombra "TikTok + réplica Reel" a "TIKTOK + REEL" con "(ESPEJO)" en una
 * segunda línea centrada, y por eso el sublabel existe.
 */

export type CategoriaFormato =
  | 'SOCIAL_CONTENT'
  | 'PLACEMENT'
  | 'EVENT'
  | 'STREAMING'
  | 'YOUTUBE'
  | 'LONGFORM'
  | 'RIGHTS'

export type UnidadFormato = 'PIEZA' | 'HORA' | 'MES' | 'EVENTO' | 'PERIODO_7D'

export interface DefinicionFormato {
  code: string
  name: string
  pdfLabel: string
  pdfSublabel?: string
  excelHeader: string
  category: CategoriaFormato
  unit: UnidadFormato
  unitLabel: string
  /** `false` cuando vender "3 piezas" no tiene sentido comercial. */
  allowsQuantity: boolean
  sortOrder: number
}

export const FORMATOS: DefinicionFormato[] = [
  { code: 'TIKTOK', name: 'TikTok', pdfLabel: 'TIKTOK', excelHeader: 'TikTok', category: 'SOCIAL_CONTENT', unit: 'PIEZA', unitLabel: 'pieza', allowsQuantity: true, sortOrder: 1 },
  { code: 'REEL_IG', name: 'Reel de Instagram', pdfLabel: 'REEL (IG)', excelHeader: 'Reel IG', category: 'SOCIAL_CONTENT', unit: 'PIEZA', unitLabel: 'pieza', allowsQuantity: true, sortOrder: 2 },
  { code: 'REEL_COLLAB', name: 'Reel colaborativo', pdfLabel: 'REEL COLABORATIVO (IG)', excelHeader: 'Reel Collab', category: 'SOCIAL_CONTENT', unit: 'PIEZA', unitLabel: 'pieza', allowsQuantity: true, sortOrder: 3 },
  {
    code: 'TIKTOK_REEL_MIRROR',
    name: 'TikTok + réplica en Reel',
    pdfLabel: 'TIKTOK + REEL',
    // Segunda línea centrada del encabezado, tal como está en el PDF de HONOR.
    pdfSublabel: '(ESPEJO)',
    excelHeader: 'TikTok + réplica Reel',
    category: 'SOCIAL_CONTENT', unit: 'PIEZA', unitLabel: 'paquete', allowsQuantity: true, sortOrder: 4,
  },
  { code: 'POST_IG', name: 'Post fijo de Instagram', pdfLabel: 'POST FIJO (IG)', excelHeader: 'Post fijo IG', category: 'SOCIAL_CONTENT', unit: 'PIEZA', unitLabel: 'pieza', allowsQuantity: true, sortOrder: 5 },
  { code: 'STORY_IG', name: 'Story de Instagram', pdfLabel: 'STORY (IG)', excelHeader: 'Story', category: 'SOCIAL_CONTENT', unit: 'PIEZA', unitLabel: 'pieza', allowsQuantity: true, sortOrder: 6 },
  { code: 'PIN_7D', name: 'Fijación 7 días', pdfLabel: 'FIJACIÓN 7 DÍAS', excelHeader: 'Fijación 7 días', category: 'PLACEMENT', unit: 'PERIODO_7D', unitLabel: 'periodo de 7 días', allowsQuantity: true, sortOrder: 7 },
  { code: 'EVENT_PRESENCE', name: 'Presencia en evento', pdfLabel: 'PRESENCIA EN EVENTO', excelHeader: 'Presencia evento', category: 'EVENT', unit: 'EVENTO', unitLabel: 'evento', allowsQuantity: true, sortOrder: 8 },
  { code: 'HOSTING', name: 'Hosteo', pdfLabel: 'HOSTEO', excelHeader: 'Hosteo', category: 'EVENT', unit: 'EVENTO', unitLabel: 'evento', allowsQuantity: true, sortOrder: 9 },
  { code: 'EVENT_STREAM', name: 'Stream de evento', pdfLabel: 'STREAM DE EVENTO', excelHeader: 'Stream evento', category: 'STREAMING', unit: 'EVENTO', unitLabel: 'evento', allowsQuantity: true, sortOrder: 10 },
  { code: 'DEDICATED_STREAM_HOUR', name: 'Stream dedicado', pdfLabel: 'STREAM DEDICADO', pdfSublabel: '(POR HORA)', excelHeader: 'Stream dedicado / hora', category: 'STREAMING', unit: 'HORA', unitLabel: 'hora', allowsQuantity: true, sortOrder: 11 },
  { code: 'YT_SHORT', name: 'YouTube Short', pdfLabel: 'YOUTUBE SHORT', excelHeader: 'YouTube Short', category: 'YOUTUBE', unit: 'PIEZA', unitLabel: 'pieza', allowsQuantity: true, sortOrder: 12 },
  { code: 'YT_INTEGRATION', name: 'Integración en YouTube', pdfLabel: 'INTEGRACIÓN YOUTUBE', excelHeader: 'Integración YouTube', category: 'YOUTUBE', unit: 'PIEZA', unitLabel: 'integración', allowsQuantity: true, sortOrder: 13 },
  { code: 'YT_DEDICATED', name: 'Video dedicado de YouTube', pdfLabel: 'VIDEO DEDICADO YOUTUBE', excelHeader: 'Video dedicado YouTube', category: 'YOUTUBE', unit: 'PIEZA', unitLabel: 'video', allowsQuantity: true, sortOrder: 14 },
  { code: 'PODCAST_MONTHLY', name: 'Podcast mensual', pdfLabel: 'PODCAST MENSUAL', excelHeader: 'Podcast mensual', category: 'LONGFORM', unit: 'MES', unitLabel: 'mes', allowsQuantity: true, sortOrder: 15 },
  { code: 'MASTERCLASS', name: 'Masterclass o experiencia', pdfLabel: 'MASTERCLASS / EXPERIENCIA', excelHeader: 'Masterclass / experiencia', category: 'EVENT', unit: 'EVENTO', unitLabel: 'experiencia', allowsQuantity: true, sortOrder: 16 },
  // No se venden "3 exclusividades" ni "2 peleas": la cantidad no aplica.
  { code: 'EXCLUSIVITY_MONTHLY', name: 'Exclusividad mensual', pdfLabel: 'EXCLUSIVIDAD MENSUAL', excelHeader: 'Exclusividad mensual', category: 'RIGHTS', unit: 'MES', unitLabel: 'mes', allowsQuantity: false, sortOrder: 17 },
  { code: 'FIGHT_FEE', name: 'Fee de pelea', pdfLabel: 'FEE DE PELEA', excelHeader: 'Fee pelea', category: 'EVENT', unit: 'EVENTO', unitLabel: 'pelea', allowsQuantity: false, sortOrder: 18 },
  { code: 'TIKTOK_AUDIO', name: 'Audio musical en TikTok', pdfLabel: 'AUDIO MUSICAL TIKTOK', excelHeader: 'Audio musical TikTok', category: 'SOCIAL_CONTENT', unit: 'PIEZA', unitLabel: 'pieza', allowsQuantity: true, sortOrder: 19 },
]

/** Columnas del TARIFARIO que NO son formatos cotizables. */
export const COLUMNAS_NO_FORMATO = [
  'Plataforma principal',
  'Estado',
  'Notas',
  'Fuente / fecha',
] as const

export const FORMATO_POR_HEADER = new Map(
  FORMATOS.map((f) => [f.excelHeader, f]),
)
export const FORMATO_POR_CODE = new Map(FORMATOS.map((f) => [f.code, f]))

/** Las 4 columnas del tabulador de HONOR, en orden. */
export const COLUMNAS_TABULADOR_HONOR = [
  'TIKTOK',
  'REEL_IG',
  'TIKTOK_REEL_MIRROR',
  'STORY_IG',
] as const
