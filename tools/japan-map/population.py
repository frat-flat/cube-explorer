# 日本地図の白地図に置く「人口に合わせた大きさのドット」のための市区町村別人口を作る。作り直すときだけ使う:
#   python3 -m pip install openpyxl && python3 tools/japan-map/population.py
# 元: 総務省「住民基本台帳に基づく人口、人口動態及び世帯数」令和4年1月1日(市区町村別・総計)CC BY 4.0
#     japandata(passaglia/japandata-sources)に入っている e-Stat の表(population/sjin/2203ssjin.xlsx)を使う
# 出力: tools/japan-map/population.json  {"団体コード(6桁)": 人口}
import io, json, tarfile, urllib.request
from pathlib import Path

import openpyxl

URL = "https://raw.githubusercontent.com/passaglia/japandata-sources/main/population/population.tar.gz"
with urllib.request.urlopen(URL) as r:
    tf = tarfile.open(fileobj=io.BytesIO(r.read()))
wb = openpyxl.load_workbook(io.BytesIO(tf.extractfile("population/sjin/2203ssjin.xlsx").read()), read_only=True)
out = {}
for row in wb.active.iter_rows(min_row=7, values_only=True):
    code, pref, name, pop = row[0], row[1], row[2], row[5]
    if code and code != "-" and name and name != "-" and isinstance(pop, (int, float)):
        out[str(code)] = int(pop)
Path(__file__).with_name("population.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
print("municipalities", len(out))
