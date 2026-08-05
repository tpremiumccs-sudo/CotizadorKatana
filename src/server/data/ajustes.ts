import 'server-only'
import { prisma } from '@/lib/db'

/**
 * Ajustes de la aplicación.
 *
 * Son los textos y valores que la agencia puede cambiar sin tocar código: las
 * consideraciones y términos por omisión, el IVA, la firma. Se leen de golpe
 * porque una cotización los necesita todos a la vez.
 */

export interface Ajustes {
  ivaBps: number
  monedaDefault: string
  vigenciaDefault: string
  consideraciones: string[]
  terminos: string[]
  confidencialidadTexto: string
  firmaTexto: string
  pieTexto: string
  eyebrow: string
  preciosEnMorado: boolean
  aprobacionModo: string
  aprobacionUmbralBps: number
}

/** Valores de respaldo: si falta un ajuste, el documento sale igual. */
const OMISION: Ajustes = {
  ivaBps: 1600,
  monedaDefault: 'MXN',
  vigenciaDefault: '15 días naturales',
  consideraciones: [],
  terminos: [],
  confidencialidadTexto: '',
  firmaTexto: '',
  pieTexto: 'Katana Talent  ·  Información confidencial',
  eyebrow: 'KATANA TALENT',
  preciosEnMorado: false,
  aprobacionModo: 'umbral',
  aprobacionUmbralBps: 2000,
}

function comoTexto(v: unknown, omision: string): string {
  return typeof v === 'string' ? v : omision
}

function comoLista(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function comoNumero(v: unknown, omision: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : omision
}

export async function leerAjustes(): Promise<Ajustes> {
  const filas = await prisma.appSetting.findMany()
  const m = new Map(filas.map((f) => [f.key, f.value as unknown]))

  return {
    ivaBps: comoNumero(m.get('iva.bps'), OMISION.ivaBps),
    monedaDefault: comoTexto(m.get('moneda.default'), OMISION.monedaDefault),
    vigenciaDefault: comoTexto(m.get('vigencia.default'), OMISION.vigenciaDefault),
    consideraciones: comoLista(m.get('consideraciones.default')),
    terminos: comoLista(m.get('terminos.default')),
    confidencialidadTexto: comoTexto(m.get('confidencialidad.texto'), ''),
    firmaTexto: comoTexto(m.get('firma.texto'), ''),
    pieTexto: comoTexto(m.get('pie.texto'), OMISION.pieTexto),
    eyebrow: comoTexto(m.get('marca.eyebrow'), OMISION.eyebrow),
    preciosEnMorado: m.get('marca.preciosEnMorado') === true,
    aprobacionModo: comoTexto(m.get('aprobacion.modo'), OMISION.aprobacionModo),
    aprobacionUmbralBps: comoNumero(
      m.get('aprobacion.umbralBps'),
      OMISION.aprobacionUmbralBps,
    ),
  }
}
