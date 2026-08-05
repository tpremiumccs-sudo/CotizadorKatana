import Link from 'next/link'

export default function Inicio() {
  return (
    <main className="min-h-dvh bg-white">
      <div className="h-[17px] w-full bg-katana-500" aria-hidden />

      <div className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24">
        <p className="text-xs font-bold tracking-[0.14em] text-katana-500">
          KATANA TALENT
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-katana-800 sm:text-4xl">
          Cotizador
        </h1>
        <p className="mt-4 max-w-prose text-tinta-suave">
          Tabuladores de tarifas y cotizaciones para marcas, con vista previa
          idéntica al PDF que se envía.
        </p>

        <div className="mt-10 rounded-katana border border-katana-200 bg-katana-100 p-5">
          <p className="text-sm text-tinta-suave">
            El sistema está en construcción. Las pantallas se irán habilitando
            por fases.
          </p>
          <Link
            href="/api/health"
            className="mt-3 inline-block text-sm font-semibold text-katana-500 underline underline-offset-4"
          >
            Ver estado del sistema
          </Link>
        </div>
      </div>
    </main>
  )
}
