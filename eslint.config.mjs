import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/.astro/**",
      "**/payload-types.ts",
      "**/importMap.js",
      "**/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
);
