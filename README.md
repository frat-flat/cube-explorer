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

動作確認:

```bash
curl http://localhost:3000/api/meta/axes
```

## よく使うコマンド

| コマンド | 内容 |
|---|---|
| `npm run db:reset` | DBを作り直し、マイグレーションとサンプルデータを入れ直す |
| `npm run db:stop` | ローカルDBを止める |
| `npm test` | ロジックの単体テスト(Vitest) |
| `npm run typecheck` / `npm run lint` | 型チェック / Lint |

## 構成

- `supabase/migrations/` サンプル業務テーブル(設計書 5.1)と `cube_meta` メタデータテーブル(5.2)
- `supabase/seed.sql` サンプルデータと、サンプル用の軸・事実定義
- `src/app/api/` API(Next.js Route Handlers)
- `src/lib/` DB接続とメタデータの型

ローカルの Supabase は DB だけを使うため、`supabase/config.toml` で認証・ストレージ・Studio などは無効にしています。
