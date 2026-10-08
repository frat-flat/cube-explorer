# fourdb の表(PostgreSQL のつなぎ)

4D Base の芯の表です。設計は [docs/4db/DATA_MODEL.md](../../../../docs/4db/DATA_MODEL.md)。

- `migrations/` 表の定義。素の PostgreSQL 15 以上だけで動くようにする(Neon・Supabase に固有の機能は使わない)
- `test/` 表の決まりと規模を確かめる SQL。**使い捨てのデータベースでだけ流す**(本番やリモートには流さない)

## 確かめ方(手元の使い捨てデータベース)

```bash
psql -h localhost -p <port> -U <user> -d <使い捨てのDB> -v ON_ERROR_STOP=1 -f migrations/0001_core.sql -f test/0001_core.check.sql
```

`0001_core.check.sql` は superuser で流します。最後に rollback するので何も残りません(試験用の役割も)。`NOTICE: OK` が 60 行出て、`NG` が出なければ通過です。

規模の確認は `test/scale.sql`(superuser で。架空のデータ 288 万個を入れ、測る用の役割 `fourdb_scale_app` を作る。数分かかる)のあとに `test/scale_queries.sql`(その役割で、行ごとの権限がかかった状態で測る)。

元に戻すときは `migrations/0001_core.down.sql`(fourdb の表とデータがすべて消える)。
