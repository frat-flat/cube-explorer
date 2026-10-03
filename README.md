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

ローカルの Supabase は DB と認証(ログイン)を使います。ストレージ・Studio などは `supabase/config.toml` で無効にしています。

## 手元で本番と同じ構成で触る

ログインあり・データベースあり・本番ビルドで、サンプルデータ(架空の申込者4・契約者9・法人17・ショップ25・入金明細1,356件)入りの状態を立ち上げます。Docker と Node.js が必要です。

```bash
npm install
npm run local              # 起動(初回はサンプルデータが自動で入る)
npm run local -- --reset   # 取り込んだデータを消して、サンプルデータの状態に戻してから起動
```

1. http://localhost:3000 を開くとログイン画面になります
2. `demo@example.com` を入れて「ログイン用のリンクを送る」
3. メールは実際には送られず、http://127.0.0.1:54324 の受信箱に届きます。そのリンクを開くとログインできます

- ログインできるメールアドレスを変えるときは `ALLOWED_EMAILS=a@example.com npm run local`
- 許可していないアドレスでリンクを開くと「閲覧の許可がありません」になります(本番と同じ動き)
- `/import` から CSV・Excel を取り込んで、自分のデータに差し替えて試せます
- サンプルデータは `supabase/seed_deposit.sql`

## 公開版(Vercel + Supabase)

実データを入れて触るための公開版の設定です。詳しくは DESIGN.md の「公開版 v0」。

| 環境変数 | 内容 |
|---|---|
| `DATABASE_URL` | Supabase の接続文字列(トランザクションプーラー・6543番) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクトの URL(ログインに使う) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase の公開キー |
| `ALLOWED_EMAILS` | 見てよいメールアドレス(カンマ区切り) |

- ローカルでは上の3つ(ログイン関係)を設定しなければ、ログインなしで動きます
- データは `/import` から、申込者 → 契約者 → 法人 → ショップ → 入金明細の順に取り込みます
- Supabase の Authentication の URL 設定で、公開先の URL と `/auth/callback` をリダイレクト先に許可してください

