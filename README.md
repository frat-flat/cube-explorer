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

`npm run dev` で使うローカルの Supabase は DB だけを使うため、`supabase/config.toml` で認証・ストレージ・Studio などは無効にしています。

## 手元で本番と同じ構成で触る(Docker 不要)

ログインあり・データベースあり・本番ビルドで、サンプルデータ(架空の申込者4・契約者9・法人17・ショップ25・入金明細1,356件)入りの状態を立ち上げます。データベースとログインは Neon(クラウド)を使うので、PC に必要なのは Node.js だけです。

### 1. Neon の準備(最初の1回だけ)

1. https://neon.com でプロジェクトを作る(リージョンは AWS Asia Pacific (Singapore) が日本から近い)
2. プロジェクトの「Auth」を開いて Neon Auth を有効にし、Configuration にある **Auth URL** を控える
3. 同じ画面のサインイン方法で「Email」を有効にし、メールの確認方法を「Verification code」にする
4. 「Connect」を押し、**Pooled connection** の接続文字列を控える

### 2. 設定を書いて起動する

```bash
npm install
npm run local              # 初回は .env.local を作って止まるので、下の3つを書いてからもう一度
npm run local -- --reset   # 取り込んだデータを消して、サンプルデータの状態に戻してから起動
```

`.env.local` に書くもの:

| 項目 | 内容 |
|---|---|
| `DATABASE_URL` | 1-4 の接続文字列 |
| `NEON_AUTH_BASE_URL` | 1-2 の Auth URL |
| `ALLOWED_EMAILS` | ログインして見てよいメールアドレス(カンマ区切り) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | (任意)スプシのリンクを読むサービスアカウントの鍵 JSON。読むスプシはその `client_email` に閲覧者として共有する |

`NEON_AUTH_COOKIE_SECRET` は `npm run local` が自動で作ります。起動したら http://localhost:3000 を開き、メールアドレスを入れると届く6桁のコードでログインします。

- 許可していないアドレスでログインすると「閲覧の許可がありません」になります(本番と同じ動き)
- `/import` から CSV・Excel を取り込んで、自分のデータに差し替えて試せます
- テーブルとサンプルデータだけ入れ直すときは `npm run db:setup`(`-- --reset` で作り直し)。中身は `supabase/migrations/` と `supabase/seed*.sql`

## 公開版(Vercel + Neon)

公開するときは、Vercel の環境変数に上の表の3つと `NEON_AUTH_COOKIE_SECRET` を入れ、Neon Auth の Trusted domains に公開先のドメインを足します。詳しくは DESIGN.md の「公開版 v0」。

- 環境変数を何も書かずに `npm run dev` すると、ローカルの Supabase の DB を使い、ログインなしで動きます
- データは `/import` から、申込者 → 契約者 → 法人 → ショップ → 入金明細の順に取り込みます
- Neon Auth の標準のメール送信は開発用です。本番で人を増やすときは、Neon Auth に自前のメール送信(SMTP)を設定します
