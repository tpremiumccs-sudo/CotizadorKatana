'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Subida del .xlsx.
 *
 * Va por `fetch` contra un Route Handler, no por Server Action: el límite de
 * 1 MB de las acciones rompería la importación justo con el archivo de verdad.
 * De paso se puede mostrar el progreso, que en un archivo de 17 hojas importa.
 */

type Fase =
  | { f: 'listo' }
  | { f: 'subiendo' }
  | { f: 'error'; mensaje: string }

export function SubirArchivo() {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [fase, setFase] = useState<Fase>({ f: 'listo' })
  const [nombre, setNombre] = useState<string | null>(null)

  async function subir(archivo: File) {
    setNombre(archivo.name)
    setFase({ f: 'subiendo' })

    const cuerpo = new FormData()
    cuerpo.append('archivo', archivo)

    try {
      const r = await fetch('/api/importaciones', { method: 'POST', body: cuerpo })
      const datos = (await r.json().catch(() => ({}))) as {
        importBatchId?: string
        error?: string
      }
      if (!r.ok || !datos.importBatchId) {
        setFase({ f: 'error', mensaje: datos.error ?? 'No se pudo leer el archivo.' })
        return
      }
      // A revisar qué cambiaría. Nada se ha aplicado todavía.
      router.push(`/importaciones/${datos.importBatchId}`)
    } catch {
      setFase({
        f: 'error',
        mensaje: 'Sin conexión con el servidor. El archivo no se subió.',
      })
    }
  }

  return (
    <div className="rounded-katana border border-dashed border-katana-300 bg-katana-50 p-6">
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        id="archivo-importacion"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void subir(f)
          // Permite volver a elegir el MISMO archivo tras un error.
          e.target.value = ''
        }}
      />

      <label
        htmlFor="archivo-importacion"
        data-touch-target
        className="inline-flex min-h-[44px] cursor-pointer items-center rounded-katana
                   bg-katana-500 px-5 text-sm font-semibold text-white
                   hover:bg-katana-600 aria-disabled:opacity-60"
        aria-disabled={fase.f === 'subiendo'}
      >
        {fase.f === 'subiendo' ? 'Leyendo el archivo…' : 'Elegir archivo .xlsx'}
      </label>

      {nombre && (
        <p className="mt-3 text-sm text-tinta-suave">
          {fase.f === 'subiendo' ? 'Procesando' : 'Último archivo'}:{' '}
          <span className="font-medium text-tinta">{nombre}</span>
        </p>
      )}

      {fase.f === 'subiendo' && (
        <p className="mt-1 text-xs text-etiqueta">
          Un CRM completo tiene 17 hojas y cerca de 400 celdas de tarifa; puede
          tardar unos segundos.
        </p>
      )}

      {fase.f === 'error' && (
        <p
          role="alert"
          data-testid="error-importacion"
          className="mt-3 rounded-katana border border-red-200 bg-red-50 px-3 py-2
                     text-sm text-error"
        >
          {fase.mensaje}
        </p>
      )}
    </div>
  )
}
