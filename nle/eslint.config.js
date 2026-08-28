import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * La règle interdisant `Math.round` ne vaut que pour le MOTEUR.
 *
 * Dans les paquets du moteur, un arrondi flottant sur un calcul temporel est un
 * bug (§12) : il faut passer par les arrondis exacts de `@valideo/time-core`.
 * Dans la couche d'affichage, en revanche, arrondir des pixels ou convertir un
 * geste de souris en images est légitime et documenté (ADR-015).
 */
const interdireArrondiFlottant = {
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.object.name='Math'][callee.property.name='round']",
        message:
          'Section 12 : pas d arrondi flottant dans les calculs temporels. Utiliser @valideo/time-core.',
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // §99 : `any` interdit sauf raison documentée.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // §105 : pas de console.log dispersés.
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  { files: ['packages/**/*.ts'], ...interdireArrondiFlottant },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
