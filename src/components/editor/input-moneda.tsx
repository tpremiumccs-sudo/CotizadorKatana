'use client'

import { useEffect, useRef, useState } from 'react'
import { pesosToCents } from '@/lib/money'

/**
 * Campo de importe en pesos.
 *
 * Se escribe como se dicta: "150000", "150,000", "150 000" o "$150,000.00" son
 * lo mismo. Mientras el campo tiene el foco NO se reformatea lo tecleado —
 * hacerlo mueve el cursor y obliga a pelearse con el campo—; al salir se
 * normaliza a "150,000".
 *
 * En iPad abre el teclado numérico: `inputMode="decimal"` en vez de
 * `type="number"`, que en móvil añade flechas inútiles y rechaza las comas.
 */

function formatearParaEdicion(centavos: number | null): string {
  if (centavos === null) return ''
  const pesos = centavos / 100
  return Number.isInteger(pesos)
    ? pesos.toLocaleString('en-US')
    : pesos.toLocaleString('en-US', { minimumFractionDigits: 2 })
}

export interface InputMonedaProps {
  valorCents: number | null
  onCommit(centavos: number | null): void
  id?: string
  'aria-label'?: string
  className?: string
  placeholder?: string
  disabled?: boolean
  onFocus?(): void
}

export function InputMoneda({
  valorCents,
  onCommit,
  className,
  disabled,
  onFocus,
  placeholder = '—',
  ...resto
}: InputMonedaProps) {
  const [texto, setTexto] = useState(() => formatearParaEdicion(valorCents))
  const [enfocado, setEnfocado] = useState(false)
  const [invalido, setInvalido] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  // Si el valor cambia desde fuera (se revirtió, o el servidor corrigió), el
  // campo lo sigue — salvo mientras se escribe en él.
  useEffect(() => {
    if (!enfocado) setTexto(formatearParaEdicion(valorCents))
  }, [valorCents, enfocado])

  function confirmar(bruto: string) {
    const limpio = bruto.trim()
    if (limpio === '') {
      setInvalido(false)
      onCommit(null)
      return
    }
    try {
      const centavos = pesosToCents(limpio)
      setInvalido(false)
      setTexto(formatearParaEdicion(centavos))
      onCommit(centavos)
    } catch {
      // No se descarta lo tecleado: se marca y se deja para corregirlo.
      setInvalido(true)
    }
  }

  return (
    <input
      {...resto}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      value={texto}
      aria-invalid={invalido || undefined}
      placeholder={placeholder}
      className={className}
      onFocus={(e) => {
        setEnfocado(true)
        onFocus?.()
        e.currentTarget.select()
      }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={(e) => {
        setEnfocado(false)
        confirmar(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          confirmar(e.currentTarget.value)
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          setTexto(formatearParaEdicion(valorCents))
          setInvalido(false)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
