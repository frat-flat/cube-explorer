# fourdb の表(PostgreSQL のつなぎ)

4D Base の芯の表です。設計は [docs/4db/DATA_MODEL.md](../../../../docs/4db/DATA_MODEL.md)。

- `migrations/` 表の定義。素の PostgreSQL 15 以上だけで動くようにする(Neon・Supabase に固有の機能は使わない)
- `test/` 表の決まりと規模を確かめる SQL。**使い捨てのデータベースでだけ流す**(本番やリモートには流さない)

## 確かめ方(手元の使い捨てデータベース)

```bash
psql -h localhost -p <port> -U <user> -d <使い捨てのDB> -v ON_ERROR_STOP=1 -f migrations/0001_core.sql -f test/0001_core.check.sql
```

`0001_core.check.sql` は superuser で流します。最後に rollback するので何も残りません(試験用の役割も)。`NOTICE: OK` が 60 行出て、`NG` が出なければ通過です。

`0005_value_rules.check.sql` は、0001〜0005 をすべて流したあとに superuser で流します(1つの文でたくさん入れたときの値・スプシの合計の決まりと、統計がいちばん悪い状態でも 2 万個が 20 秒以内に入るか)。統計の状態はこの中で作るので、データベースの来歴によらず同じ結果になります(rollback で元に戻る)。止めるときの文が 0001・0002 とまったく同じかも見ます。`NOTICE: OK` が 20 行出れば通過です。表の大きさの記録と列の統計を書き換え、自動の vacuum を止めるので、名前が `fourdb_it…` か `test`・`check`・`perf` を含むデータベースか、workspace が1つもないデータベースでしか流れません(それ以外では最初に止まります)。

`0006_principal_pref.check.sql` は、0001〜0006 を流したあとに superuser で流します(アカウントごとの設定の表の RLS の強制・方針・表の決まり・権限と、元に戻す `0006_principal_pref.down.sql` を、この中で本物のファイルのまま流して確かめる)。最後に rollback するので何も残りません。`NOTICE: OK` が 48 行出れば通過です(down が止まる確かめで、行の数だけを含む ERROR が 2 回出ます。想定どおり)。0005 の確かめと同じく、試験用の名前のデータベースでしか流れません。

規模の確認は `test/scale.sql`(superuser で。架空のデータ 288 万個を入れ、測る用の役割 `fourdb_scale_app` を作る。数分かかる)のあとに `test/scale_queries.sql`(その役割で、行ごとの権限がかかった状態で測る)。
ホームと Task の規模は、`test/scale.sql` のあとに `test/scale_home.sql`(`-v variant=V1` か `V2`。Box・行の結び・計算された値・予算のシート・取り込みの記録を足す)を流し、`home.scale.test.ts` で測ります(`FOURDB_SCALE_APP_URL` に手元の `fourdb_scale_app` の接続先を入れたときだけ動く)。SQL の下書きと測った結果は `test/home.sql.md`。

## アカウントごとの設定(0006)と、計算された値の索引(0007)

- `0006_principal_pref.sql` は、アカウント(principal)ごとに 1 行の設定(明暗・World・ホームの見た目)の表 `fourdb.principal_pref` を作ります。行ごとの権限を強制し、「今の処理の利用者」(`fourdb.current_principal()`。withScope が入れる `fourdb.principal`)の行だけを読み書きできます。読み書きは `prefs.ts`(principal をパラメータでも絞る)。
  - 表がない・実行用の役割に権限がないとき、アプリは止まらず、設定の GET は `available: false` と既定の設定、PUT は「使えない」(API は 503)になります。権限は `fourdb:setup-remote`(`grantApp`)で渡ります。流したあとに権限を渡すまでは「使えない」のままです。
  - 元に戻す `0006_principal_pref.down.sql` は、表に行(利用者が保存した設定)があれば消さずに止まり、行の数を知らせます。消すと決めたときだけ、1 つの取引の中で `begin; set local fourdb.discard_principal_pref = '<その数>'; <この down の SQL>; commit;` の形で流し直します(数が今の行の数と同じときだけ通る。`local` を付けない set は、接続に残るので使いません)。down の SQL 自体は 1 つの DO 文だけでできています。流したあとは `fourdb_migrations.applied` から `0006_principal_pref.sql` の行を消します。
- `0007_value_calculated_index.sql` は、計算された値の今の版だけの部分索引 `value_calculated`(`value (column_id) where kind = 'calculated' and system_to is null`)を作ります。ホームの「数値」の欄の ƒ の判定に使います(ないと、規模の確認で 1〜2 秒かかる)。
  **流す(0007)のも元に戻す(down)のも、取り込み(反映)をしていない時間に行います。** 作る間は `value` 表への書き込みが待たされ(読むのは止まらない)、外すときは一瞬すべて押さえます。どちらも待ちが 5 秒を超えたら止まります(`lock_timeout`。止まっても何も変わらない)。作る時間が 60 秒を超えても止まり、取引ごと元に戻ります(0007 の `statement_timeout`)。元に戻したあとは `fourdb_migrations.applied` から `0007_value_calculated_index.sql` の行を消します。

元に戻すときは `migrations/0001_core.down.sql`(fourdb の表とデータがすべて消える)。

## 反映(取り込みを書くところ)のつくりを入れ替える・元に戻すとき

反映は1回の呼び出しを時間で区切り、途中の位置を `import_run.cursor` に残します(`apply.ts`)。前のつくり(2026-10-09 より前)と新しいつくりは、同じ取り込みの続きを互いに書けます。ただし次を守ります。

- **アプリを前のつくりに戻す前に**、反映の途中の取り込み(`status = 'applying'`)を、新しいつくりのまま終わらせる。画面(/migrate)で「反映を続ける」が出ているタブがあれば、押して最後まで書く。
  データベースを直接見られるときは、行ごとの権限を飛ばせる接続で、次が 0 行であることを確かめる:
  `set row_security = off;`
  `select id, sheet_id from fourdb.import_run where status = 'applying' and cursor -> 'apply' -> 'finish' is not null;`
  先に `set row_security = off;` にするのは、行ごとの権限がかかる接続(実行用の役割や、強制がかかった表の持ち主)だと、見えない行を黙って 0 行と返してしまうため。この設定にしておくと、権限を飛ばせない接続では 0 行ではなくエラーになる(その場合は、権限を飛ばせる接続でやり直すか、画面で確かめる)。
  理由: 読み直しの片付けは置き場(`import_row`)を区切って消す。消しかけの状態から前のつくりが続きを書くと、消えた置き場の行を「スプシからなくなった行」とみなして閉じてしまう(5 万行を超える読み直しで起こる)。
  新しいつくりは、なくなった行を閉じ終えた時点で `hadRecords` を false にして、この閉じ直しが起きないようにしているが、念のため守る。
- `0005_value_rules_lookup.sql` は値・スプシの合計の確かめ(トリガー)の引き方を変え、行の `sheet_id` だけの索引 `record_sheet` を外す(決まりは変わらない)。元に戻す `0005_value_rules_lookup.down.sql` は索引を作り直す。
  **流す(0005)のも元に戻す(down)のも、取り込み(反映)をしていない時間に行う。** 索引を外す・作り直す間は `record` 表を押さえる(外すときは読み書きとも、作り直すときは書き込みを止める)。どちらも待ちが 5 秒を超えたら止まる(`lock_timeout`)ので、止まったら取り込みが終わってから流し直す(途中で止まっても何も変わらない)。
