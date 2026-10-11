/** { … } の形のオブジェクト(配列・null・文字列・数・Map などは通さない)。このフォルダの中だけで使う */
export const isRecord = (v: unknown): v is Record<string, unknown> => Object.prototype.toString.call(v) === "[object Object]";
