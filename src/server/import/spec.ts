import type { EspecificacionEncabezado } from './types'
import { FORMATOS, COLUMNAS_NO_FORMATO } from './catalogo'

/**
 * Qué encabezados espera cada hoja.
 *
 * Los `requeridos` son los mínimos para dar la hoja por reconocida. Se dejan
 * cortos a propósito: si el Excel gana una columna, la importación debe seguir
 * funcionando y reportar la columna nueva, no romperse.
 */

export const SPEC_TARIFARIO: EspecificacionEncabezado = {
  entidad: 'TARIFARIO',
  hoja: 'TARIFARIO KATANA',
  requeridos: [
    'Talento',
    ...FORMATOS.map((f) => f.excelHeader),
    ...COLUMNAS_NO_FORMATO,
  ],
  sinonimos: {
    Talento: ['Nombre', 'Talento / perfil'],
    Story: ['Story IG', 'Stories'],
    'Fijación 7 días': ['Fijacion 7 dias', 'Fijación 7 dias'],
    'Stream dedicado / hora': ['Stream dedicado/hora', 'Stream dedicado por hora'],
    'Fuente / fecha': ['Fuente/fecha', 'Fuente y fecha'],
  },
}

export const SPEC_PERFIL: EspecificacionEncabezado = {
  entidad: 'PERFIL',
  hoja: 'PERFIL COMERCIAL — CAPTURA',
  requeridos: [
    'talent_id',
    'canonical_name',
    'display_name',
    'Biografía breve',
    'Logros principales',
    'source_status',
  ],
  sinonimos: {
    talent_id: ['id', 'talentid'],
    canonical_name: ['nombre canónico'],
    display_name: ['nombre a mostrar'],
    'Biografía breve': ['Biografia breve', 'Bio'],
    'Colaboraciones y campañas': ['Colaboraciones'],
    'Marcas relacionadas': ['Marcas'],
    library_folder_id: ['carpeta drive'],
  },
}

export const SPEC_TALENTOS: EspecificacionEncabezado = {
  entidad: 'TALENTOS',
  hoja: 'TALENTOS',
  requeridos: [
    'Talento',
    'Categoría',
    'Verticales que abre',
    'Tipo (casa / aliado)',
    'IG seguidores',
    'TikTok seguidores',
    'YouTube subs',
  ],
  sinonimos: {
    Categoría: ['Categoria'],
    'Verticales que abre': ['Verticales'],
    'Tipo (casa / aliado)': ['Tipo', 'Tipo casa aliado'],
    'IG seguidores': ['Instagram seguidores', 'Instagram'],
    'TikTok seguidores': ['TikTok'],
    'YouTube subs': ['YouTube', 'YouTube suscriptores'],
    'Notas / ángulo comercial': ['Notas', 'Ángulo comercial'],
    'País / mercado': ['Pais / mercado', 'País'],
  },
}

export const SPEC_PROPUESTAS: EspecificacionEncabezado = {
  entidad: 'PROPUESTAS',
  hoja: 'PROPUESTAS KATANA ENGINE',
  requeridos: ['Folio', 'Fecha', 'Cliente', 'Proyecto', 'Estatus'],
  sinonimos: {
    'Contacto cliente': ['Contacto'],
    'Agente / proveedor': ['Agente'],
    'Talentos cotizados': ['Talentos'],
    'Moneda / impuestos': ['Moneda'],
  },
}

export const SPEC_CATALOGOS: EspecificacionEncabezado = {
  entidad: 'CATALOGOS',
  hoja: 'CATALOGOS',
  requeridos: ['VERTICALES', 'TIPO DE LEAD', 'ESTATUS LEAD', 'ETAPA DEAL'],
}

export const SPEC_ROSTER_BASE: EspecificacionEncabezado = {
  entidad: 'ROSTER_BASE',
  hoja: 'Base de Talentos',
  requeridos: [
    'Talento',
    'Instagram',
    'TikTok',
    'YouTube',
    'Facebook',
    'Link Instagram',
  ],
  sinonimos: {
    'Total seguidores': ['Total'],
    'Última actualización': ['Ultima actualizacion'],
  },
}

export const SPEC_ROSTER_PERFIL: EspecificacionEncabezado = {
  entidad: 'ROSTER_PERFIL',
  hoja: 'Perfil comercial',
  requeridos: ['Talento', 'Biografía breve', 'Logros principales'],
}

export const SPEC_KIF: EspecificacionEncabezado = {
  entidad: 'KIF',
  hoja: 'KIF — Base de Talentos',
  requeridos: [
    'Talento',
    'Username',
    'Categoría principal',
    'Estatus KIF',
    'Estado de tarifa',
  ],
  sinonimos: {
    'Categoría principal': ['Categoria principal'],
    Subcategorías: ['Subcategorias'],
  },
}

export const SPEC_FIERA: EspecificacionEncabezado = {
  entidad: 'FIERA',
  hoja: 'FIERA — Roster & Matchmaking',
  requeridos: ['Nombre / Alias', 'País', 'Categoría', 'Estatus CRM'],
  sinonimos: {
    'Nombre / Alias': ['Nombre', 'Alias'],
    País: ['Pais'],
    Categoría: ['Categoria'],
    'Peso / división': ['Peso', 'División'],
  },
}

export const SPECS_CRM_COMERCIAL = [
  SPEC_TARIFARIO,
  SPEC_PERFIL,
  SPEC_TALENTOS,
  SPEC_PROPUESTAS,
  SPEC_CATALOGOS,
] as const

export const SPECS_ROSTER = [
  SPEC_ROSTER_BASE,
  SPEC_ROSTER_PERFIL,
  SPEC_KIF,
  SPEC_FIERA,
] as const
