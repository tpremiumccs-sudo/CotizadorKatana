import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
})

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'next-env.d.ts', // lo genera Next en cada build
      'src/generated/**',
      'tests/**/__salida__/**',
      'respaldos/**',
    ],
  },

  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  // ── Candados de arquitectura ────────────────────────────────────────────
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // Prisma solo se toca desde la capa de datos: así toda consulta pasa por el
  // sitio donde se aplica el filtro por rol.
  //
  // `src/server/auth/**` queda fuera a propósito: es la capa PRE-autenticación
  // —sesiones e intentos de acceso— y ahí todavía no existe un actor por el que
  // filtrar. Es justamente el código que averigua quién es el actor. Las
  // consultas de negocio del flujo de acceso sí viven en src/server/data.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/server/data/**',
      'src/server/auth/**',
      'src/lib/db.ts',
      'src/app/api/health/**',
    ],
    rules: {
      // La variante de typescript-eslint entiende `import type`, que se borra
      // al compilar y por tanto no viola nada.
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/db',
              allowTypeImports: true,
              message:
                'Prisma solo se usa desde src/server/data/**, que es donde se filtra por rol.',
            },
            {
              name: '@prisma/client',
              importNames: ['PrismaClient'],
              // `import type` se borra al compilar: no instancia nada.
              allowTypeImports: true,
              message:
                'No instancies PrismaClient: usa el singleton de src/lib/db.ts desde la capa de datos.',
            },
          ],
        },
      ],
    },
  },

  // ⭐ El documento se renderiza EXACTAMENTE igual en pantalla y en el PDF.
  // Cualquier bifurcación aquí es la puerta por la que se cuela la divergencia
  // entre lo que Chuy ve en la junta y lo que recibe la marca.
  {
    files: ['src/components/doc/**/*.{ts,tsx}', 'src/lib/doc/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Identifier[name=/^(isPrint|isPreview|esImpresion|esPreview)$/]",
          message:
            'Prohibido bifurcar el documento entre preview e impresión: el PDF y la vista previa deben ser el mismo DOM.',
        },
        {
          selector:
            "BinaryExpression[operator='!=='][left.operator='typeof'][left.argument.name='window']",
          message:
            'Prohibido `typeof window` en el documento: introduce diferencias entre servidor y cliente.',
        },
        {
          selector: "MemberExpression[object.name='navigator']",
          message: 'El documento no puede depender del navegador.',
        },
      ],
    },
  },
]

export default config
