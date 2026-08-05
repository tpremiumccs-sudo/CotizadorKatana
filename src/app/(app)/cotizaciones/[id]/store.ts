'use client'

import { create } from 'zustand'
import {
  claveCelda,
  type CeldaEditor,
  type EstadoEditor,
  type EstadoPrecioEditor,
} from '@/lib/editor/tipos'

/**
 * Estado del editor en el navegador.
 *
 * Lo que se teclea se aplica AL INSTANTE al estado local —de ahí que la vista
 * previa responda sin esperar al servidor— y se guarda después. Si el guardado
 * falla, la celda vuelve a lo que había: nunca se queda en pantalla una cifra
 * que el servidor no aceptó.
 */

export type EstadoGuardado =
  | { fase: 'limpio' }
  | { fase: 'pendiente' }
  | { fase: 'guardando' }
  | { fase: 'guardado'; en: number }
  | { fase: 'error'; mensaje: string }
  | { fase: 'conflicto'; mensaje: string; quien: string | null }

interface Acciones {
  /** Aplica el cambio en pantalla y lo encola para guardar. */
  ajustarPrecio(
    clave: string,
    cambio: { status: EstadoPrecioEditor | null; amountCents: number | null },
  ): void
  /** Quita el ajuste y vuelve al precio del tarifario. */
  revertir(clave: string): void
  marcarGuardando(): void
  aplicarGuardado(clave: string, celda: CeldaEditor, revision: number): void
  fallarGuardado(clave: string, mensaje: string): void
  entrarEnConflicto(mensaje: string, quien: string | null): void
  seleccionar(clave: string | null): void
}

export interface EstadoTienda {
  doc: EstadoEditor
  /** Copia de la celda antes del último cambio, para poder deshacer. */
  respaldo: Record<string, CeldaEditor>
  guardado: EstadoGuardado
  /** Celdas con un cambio aún sin confirmar por el servidor. */
  sucias: Set<string>
  seleccionada: string | null
}

export type Tienda = EstadoTienda & Acciones

export function crearTienda(inicial: EstadoEditor) {
  return create<Tienda>((set) => ({
    doc: inicial,
    respaldo: {},
    guardado: { fase: 'limpio' },
    sucias: new Set(),
    seleccionada: null,

    ajustarPrecio: (clave, cambio) =>
      set((s) => {
        const actual = s.doc.celdas[clave]
        if (!actual) return s
        return {
          doc: {
            ...s.doc,
            celdas: {
              ...s.doc.celdas,
              [clave]: {
                ...actual,
                overridePriceStatus: cambio.status,
                overrideAmountCents:
                  cambio.status === 'QUOTED' ? cambio.amountCents : null,
              },
            },
          },
          // Sólo se respalda el primer cambio: es el estado al que hay que
          // volver si el guardado falla, no el penúltimo tecleo.
          respaldo: s.respaldo[clave] ? s.respaldo : { ...s.respaldo, [clave]: actual },
          sucias: new Set(s.sucias).add(clave),
          guardado: { fase: 'pendiente' },
        }
      }),

    revertir: (clave) =>
      set((s) => {
        const actual = s.doc.celdas[clave]
        if (!actual) return s
        return {
          doc: {
            ...s.doc,
            celdas: {
              ...s.doc.celdas,
              [clave]: {
                ...actual,
                overridePriceStatus: null,
                overrideAmountCents: null,
                overrideReason: null,
              },
            },
          },
          respaldo: s.respaldo[clave] ? s.respaldo : { ...s.respaldo, [clave]: actual },
          sucias: new Set(s.sucias).add(clave),
          guardado: { fase: 'pendiente' },
        }
      }),

    marcarGuardando: () => set({ guardado: { fase: 'guardando' } }),

    aplicarGuardado: (clave, celda, revision) =>
      set((s) => {
        const sucias = new Set(s.sucias)
        sucias.delete(clave)
        const respaldo = { ...s.respaldo }
        delete respaldo[clave]
        return {
          // La celda que devuelve el servidor manda: trae el base, que el
          // cliente nunca modifica, y confirma cómo quedó el ajuste.
          doc: { ...s.doc, revision, celdas: { ...s.doc.celdas, [clave]: celda } },
          respaldo,
          sucias,
          guardado: sucias.size
            ? { fase: 'pendiente' }
            : { fase: 'guardado', en: revision },
        }
      }),

    fallarGuardado: (clave, mensaje) =>
      set((s) => {
        const previa = s.respaldo[clave]
        const sucias = new Set(s.sucias)
        sucias.delete(clave)
        const respaldo = { ...s.respaldo }
        delete respaldo[clave]
        return {
          doc: previa
            ? { ...s.doc, celdas: { ...s.doc.celdas, [clave]: previa } }
            : s.doc,
          respaldo,
          sucias,
          guardado: { fase: 'error', mensaje },
        }
      }),

    // En conflicto NO se revierte nada: lo tecleado sigue en pantalla para que
    // se pueda copiar antes de recargar. Perder el trabajo sería peor que el
    // conflicto.
    entrarEnConflicto: (mensaje, quien) =>
      set({ guardado: { fase: 'conflicto', mensaje, quien } }),

    seleccionar: (clave) => set({ seleccionada: clave }),
  }))
}

export { claveCelda }
