// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'prisma/migrations/**'],
  },

  // Código de aplicación (`src/`): cubierto por `tsconfig.json`, así que
  // aquí sí podemos usar reglas type-aware (detectan promesas no
  // manejadas, `any` implícitos que `strict` no cubre, etc.).
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // El estilo del proyecto usa `interface` para las formas de objeto
      // exportadas (ver `modules/*/service.ts`) y estas reglas son
      // puramente estilísticas, no detectan bugs reales.
      '@typescript-eslint/consistent-type-definitions': 'off',
      // Los DTOs derivados de Zod (`z.infer<...>`) y los repos de Prisma
      // producen uniones/plantillas donde el chequeo estricto de
      // template-expressions da falsos positivos constantes.
      '@typescript-eslint/restrict-template-expressions': 'off',
      // Prisma/Zod devuelven `unknown`/tipos amplios en varios puntos del
      // borde (parsers, JSON de Prisma); exigir un cast explícito ahí no
      // añade seguridad real y generaría ruido en todo el código existente.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',

      // Todo `*Routes` es `const x: FastifyPluginAsync = async (app) => {...}`
      // — la firma la exige Fastify aunque el cuerpo solo registre rutas de
      // forma síncrona (no hay `await` real que hacer). Falso positivo
      // sistemático en los ~8 módulos, no un bug.
      '@typescript-eslint/require-await': 'off',
      // Los controllers (`create*Controller`) son objetos planos cuyos
      // métodos cierran sobre el `service` por clausura y nunca usan
      // `this`; se pasan como referencia directa a `server.get/post/...`.
      // La regla asume que cualquier método de interfaz podría depender de
      // `this` al desacoplarse, lo cual no aplica a este patrón factory.
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Tests, seed de Prisma y archivos de configuración raíz: no forman
  // parte de `tsconfig.json` (`include` está limitado a `src/**/*.ts`),
  // así que se lintean sin reglas type-aware para no requerir un
  // `tsconfig` propio solo para el linter.
  {
    files: ['tests/**/*.ts', 'prisma/**/*.ts', '*.config.ts', '*.config.js'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  {
    files: ['eslint.config.js'],
    extends: [js.configs.recommended],
  },
);
