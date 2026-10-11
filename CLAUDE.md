@AGENTS.md

4D Base の仕様は [docs/4db/](./docs/4db/) にある。次の順に読み、上にあるものほど新しい決定として優先する。

1. [docs/4db/DECISIONS.md](./docs/4db/DECISIONS.md) — ユーザーの決定(Card の扱い、スプシからの移行、実装の順番、芯・つなぎ・入れ物の分け方など)
2. [docs/4db/REQUIREMENTS.md](./docs/4db/REQUIREMENTS.md) — ① 要件定義書
3. [docs/4db/TECHNICAL_DESIGN.md](./docs/4db/TECHNICAL_DESIGN.md) — ② 技術設計
4. [docs/4db/DEVELOPMENT.md](./docs/4db/DEVELOPMENT.md) — ③ 開発指示書(進め方)。実装の順番は DECISIONS.md の D-003 に従う

この環境(このリポジトリ・公開先)だけの決まりは [docs/deployment/ENVIRONMENT.md](./docs/deployment/ENVIRONMENT.md)、現状の調査は [docs/deployment/AUDIT-2026-10-08.md](./docs/deployment/AUDIT-2026-10-08.md)。

[DESIGN.md](./DESIGN.md) は旧設計(v0.1)と、2026-10 上旬までの画面ごとの決定記録。旧の画面(`public/sheets/axes.html`。P2 で外した。中身は git の履歴にある)の挙動を確かめるときに参照する。新しい作りでも次は守る:

- SQL の表名・列名はメタデータの値からだけ組み立て、値はすべてパラメータで渡す(DESIGN.md 7.2)
- 区切りごとに、ロジックは Vitest、画面は Playwright で実際に動かして確かめる(DESIGN.md 12)
