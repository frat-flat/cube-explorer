# cube-explorer(立体テーブル管理システム)

既存のRDBを作り直さずに、立体的(多軸)に閲覧・探索するための層です。設計は [DESIGN.md](./DESIGN.md) を参照してください。

## 必要なもの

- Node.js 22 以上
- Docker(ローカルの Supabase を動かすため)

## はじめかた

```bash
npm install
npm run db:start      # ローカルDBを起動(初回はマイグレーションとサンプルデータも投入)
cp .env.example .env.local
npm run dev           # http://localhost:3000
```

http://localhost:3000 を開くと面ビュー(Cube Explorer)が表示されます。

## よく使うコマンド

| コマンド | 内容 |
|---|---|
| `npm run db:reset` | DBを作り直し、マイグレーションとサンプルデータを入れ直す |
| `npm run db:stop` | ローカルDBを止める |
| `npm test` | ロジックの単体テスト(Vitest)。`DATABASE_URL` を付けるとDBとの突き合わせテストも走る |
| `npm run test:e2e` | 画面テスト(Playwright)。ローカルDBの起動が必要 |
| `npm run typecheck` / `npm run lint` | 型チェック / Lint |

## 構成

- `supabase/migrations/` サンプル業務テーブル(設計書 5.1)と `cube_meta` メタデータテーブル(5.2)
- `supabase/seed.sql` サンプルデータと、サンプル用の軸・事実定義
- `src/app/api/` API(Next.js Route Handlers):`/api/meta/axes` `/api/meta/facts` `/api/cube/face`
- `src/lib/cube/` クエリエンジン(CubeSpec の検証 `validate.ts`、SQL組み立て `sql.ts`、実行と整形 `engine.ts`)と画面の状態 `store.ts`
- `src/lib/meta/` メタデータの型と読み込み
- `src/components/` 面ビューと軸設定パネル
- `e2e/` 画面テスト

ローカルの Supabase は DB だけを使うため、`supabase/config.toml` で認証・ストレージ・Studio などは無効にしています。
