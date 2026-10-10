import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 4D Base の芯は、入れ物(Next.js・React・ログイン)やつなぎ(データベース・Google)に依存しない(D-004)
  {
    files: ["src/fourdb/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*"], message: "芯は Next.js・React に依存しない(D-004)" },
            { group: ["@neondatabase/*", "@supabase/*", "postgres", "pg"], message: "芯はログインやデータベースのライブラリに依存しない(D-004)" },
            { group: ["@/fourdb/adapters/*", "@/fourdb/adapters/**", "**/adapters/**"], message: "芯はつなぎ(adapters)を読み込まない(D-004)" },
            { group: ["@/app/*", "@/app/**", "@/lib/*", "@/lib/**"], message: "芯は入れ物(src/app・src/lib)を読み込まない(D-004)" },
            { group: ["node:*", "fs", "path", "crypto"], message: "芯は Node の機能に依存しない(組み込み先で動くように)" },
          ],
        },
      ],
    },
  },
  // 立体のホーム(src/fourdb/ui)は three と芯だけに依存する(D-004・P2b の 2 章)。画面(React)・入れ物・つなぎ・Node の機能を読まない。
  // 読んでよいのは 'three'・'three/examples/jsm/**'・'@/fourdb/core/**' と、同じフォルダの中('./…')だけ(試験 *.test.ts は vitest も)
  ...[false, true].map((test) => ({
    files: test ? ["src/fourdb/ui/**/*.test.ts"] : ["src/fourdb/ui/**/*.ts", "src/fourdb/ui/**/*.tsx"],
    ...(test ? {} : { ignores: ["src/fourdb/ui/**/*.test.ts"] }),
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*"], message: "立体のモジュールは Next.js・React に依存しない(画面は src/app/(app)/_home が描く)" },
            { group: ["@/app/*", "@/app/**", "@/lib/*", "@/lib/**"], message: "立体のモジュールは入れ物(src/app・src/lib)を読み込まない(D-004)" },
            { group: ["@/fourdb/adapters/*", "@/fourdb/adapters/**", "**/adapters/**"], message: "立体のモジュールはつなぎ(adapters)を読み込まない(D-004)" },
            { group: ["node:*", "fs", "path", "crypto"], message: "立体のモジュールは Node の機能に依存しない(ブラウザで動く)" },
            {
              regex: `^(?!(${test ? "vitest|" : ""}three|three/examples/jsm/.+|@/fourdb/core|@/fourdb/core/.+|\\./[^/].*)$)`,
              message: "立体のモジュールが読んでよいのは 'three'・'three/examples/jsm/**'・'@/fourdb/core/**' と同じフォルダの中('./…')だけ(試験は vitest も)",
            },
          ],
        },
      ],
    },
  })),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
