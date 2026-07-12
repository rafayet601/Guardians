// Flat ESLint config (ESLint 10 + Expo SDK 56). `eslint-config-expo/flat`
// bundles the React, React Hooks, TypeScript, and import rules tuned for Expo.
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'dist/*',
      'web-build/*',
      '.expo/*',
      'node_modules/*',
      'ios/*',
      'android/*',
      'supabase/functions/*', // Deno runtime — linted separately via `deno lint`
      'src/types/database.ts', // generated from the Supabase schema
      'docs/*',
      '.claude/workflows/*', // Workflow-tool DSL: top-level await/return outside a function scope
    ],
  },
  {
    rules: {
      // Stale closures / missing deps are easy to introduce with React Query +
      // Reanimated 4; surface them as warnings rather than hard failures.
      'react-hooks/exhaustive-deps': 'warn',
      // Advisory React-Compiler-era rule; the flagged mount-effect → fetch/setState
      // patterns here are intentional. Keep the signal, don't fail the gate.
      'react-hooks/set-state-in-effect': 'warn',
      // False positive on Reanimated: `sharedValue.value = …` is the idiomatic
      // worklet API, not an illegal mutation. The React-Compiler rule isn't
      // Reanimated-aware, so it flags every animation. Off for this codebase.
      'react-hooks/immutability': 'off',
      // Apostrophes in user-facing copy ("don't", "you've") are fine.
      'react/no-unescaped-entities': 'off',
      // We deliberately lazy-`require('@sentry/react-native')` so the bundle
      // builds without the package installed (see src/lib/observability.ts).
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
