// ホームの上限(D-017。③ 設計 4 章)。SQL の LIMIT と、画面に出す件数の両方がこの値を使う。

export const HOME_LIMITS = {
  /** 立体にする単位の数。7 つ目からは「ほかの単位」の 1 行 */
  units: 6,
  /** 単位ごとの名前 */
  names: 5,
  /** 「ほかの単位」に並べる数(これを超えた分は more) */
  others: 30,
  /** 「中に」「Card の項目」「数値」の並び */
  fields: 12,
  /** 「元のシート」 */
  sheets: 3,
  /** Table */
  tables: 3,
  /** 単位の種類(unit_type の違い)を読む数。SQL の LIMIT */
  unitTypes: 500,
  /** 「中に」を数えるときにたどる Box の深さ。SQL の再帰の上限 */
  depth: 16,
  /** 照合のために読む表の定義の数。SQL の LIMIT */
  tableDefinitions: 500,
} as const;
