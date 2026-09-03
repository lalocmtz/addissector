import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Color literals live ONLY in src/app/globals.css (design tokens). Any hex in a
// component or lib is a lint error — theme switching depends on it.
const HEX = "/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/";
const noHexColors = {
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: `Literal[value=${HEX}]`,
        message: "No hex color literals in src/. Use a token from globals.css (bg-surface, text-ink, var(--color-accent)…).",
      },
      {
        selector: `TemplateElement[value.raw=${HEX}]`,
        message: "No hex color literals in src/. Use a token from globals.css.",
      },
      {
        selector: `JSXAttribute > Literal[value=${HEX}]`,
        message: "No hex color literals in JSX attributes. Use a token from globals.css.",
      },
    ],
  },
};

// Data is fetched in effects across the app (load() → setState). The React
// Compiler rule flags that pattern; it is pre-existing and gets addressed when
// each screen is rebuilt (phases C–E), so it warns instead of failing lint.
const legacyDataFetching = {
  files: ["src/**/*.{ts,tsx}"],
  rules: { "react-hooks/set-state-in-effect": "warn" },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  noHexColors,
  legacyDataFetching,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deno edge functions: another runtime, linted by Deno.
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
