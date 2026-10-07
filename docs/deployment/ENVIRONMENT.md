# この環境の決まり(cube-explorer)

4D Base の仕様(どの組み込み先でも共通)は [../4db/](../4db/DECISIONS.md) にある。ここには、このリポジトリ・この公開先だけの決まりと構成を書く。
Synapse などへ組み込むときは、その組み込み先の分をこの文書と同じ形で作る。

## ユーザーの決定

| 日付 | 決定 |
|---|---|
| 2026-10-08 | 使うのは当面ユーザー本人だけ。データはログインした人ごとに持ち、共有はあとから足せる形にする |
| 2026-10-08 | 本番に入っているデータは試しに触っただけで、消えてもよい。旧 `cube_workspaces`(1人1件の JSON)から新しい形への移行手順は作らない。実際に消すときは改めて確認する |

## 構成(2026-10-08 時点)

| 役割 | 使っているもの | 備考 |
|---|---|---|
| 画面の公開 | Vercel(プロジェクト `cube-explorer`) | PR ごとにプレビューが出る |
| ログイン | Neon Auth(メールの6桁コード) | `ALLOWED_EMAILS` に入れた人だけ。入口は `src/proxy.ts` |
| データ(旧) | Supabase の `cube_workspaces` | ログインした人(メールアドレス)ごとに1件の JSON。上限 5MB。サーバーが秘密の鍵で読み書きする |
| スプシの読み取り | Google のサービスアカウント | 閲覧のみ(`spreadsheets.readonly`)。読ませたいスプシをこのアカウントに共有する |

環境変数(名前だけ): `NEON_AUTH_BASE_URL`・`NEON_AUTH_COOKIE_SECRET`・`ALLOWED_EMAILS`・`SUPABASE_URL`・`SUPABASE_SECRET_KEY`・`GOOGLE_SERVICE_ACCOUNT_JSON`。

## 未確認のこと

- 本番がつないでいる Supabase のプロジェクト。2026-10-08 に接続できる Supabase の組織には、4D Base 用と分かるプロジェクトが見当たらなかった。
- Vercel の環境変数の設定状況。2026-10-08 時点で、接続した Vercel のツールからはこのプロジェクトが見えず、手元の Vercel CLI はユーザー名(日本語)を HTTP ヘッダーに入れられずにエラーになった。

## 手元での起動

[README](../../README.md) のとおり `npm run dev`。手元の `.env.local` にはログイン(Neon Auth)の設定だけがあり、スプシのリンク読み取りと Supabase への保存は手元では動かない(2026-10-08 時点)。
