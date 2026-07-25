#!/usr/bin/env python3
"""
將 sushiro-hk-tracker.gosa.app 渲染出嚟嘅數字,同官方 SushiPass API 嘅欄位並排比對。

目的:唔靠任何第三方專案嘅解讀,直接用「用戶指定嘅參考網站實際顯示緊乜」
      去確認每個官方欄位嘅真正意思。

用法:python3 scripts/compare_gosa.py <gosa.html> <official.json>
"""
import json
import re
import sys
from html.parser import HTMLParser


class TextExtractor(HTMLParser):
    """抽出可見文字,順便記住每段文字喺原始 HTML 嘅位置。"""

    SKIP = {"script", "style", "head", "meta", "link"}

    def __init__(self):
        super().__init__()
        self.parts = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth:
            return
        t = data.strip()
        if t:
            self.parts.append(t)

    def text(self):
        return "\n".join(self.parts)


def load_official(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        data = data.get("stores") or data.get("data") or []
    return data


def main():
    html_path, json_path = sys.argv[1], sys.argv[2]

    with open(html_path, encoding="utf-8", errors="replace") as f:
        html = f.read()

    stores = load_official(json_path)
    print(f"官方 API 分店數: {len(stores)}")
    print(f"gosa.app HTML: {len(html)} bytes")
    print()

    extractor = TextExtractor()
    extractor.feed(html)
    text = extractor.text()
    lines = [l for l in text.split("\n") if l]
    print(f"gosa.app 可見文字行數: {len(lines)}")
    print()

    print("=" * 78)
    print("gosa.app 頁面可見文字(頭 120 行)")
    print("=" * 78)
    for l in lines[:120]:
        print(f"  {l}")
    print()

    # 逐間官方分店,喺 gosa HTML 入面搵佢個名,睇吓附近顯示緊咩數字
    print("=" * 78)
    print("逐店比對:官方欄位  vs  gosa.app 名稱附近顯示嘅內容")
    print("=" * 78)

    hits = 0
    for s in stores[:15]:
        name = s.get("name", "")
        if not name:
            continue
        official = (
            f"wait={s.get('wait')}  waitingGroup={s.get('waitingGroup')}  "
            f"waitTimeCounter={s.get('waitTimeCounter')}  status={s.get('storeStatus')}"
        )
        print(f"\n── {name}")
        print(f"   官方: {official}")

        idx = html.find(name)
        if idx < 0:
            print("   gosa: (頁面搵唔到呢間店個名)")
            continue
        hits += 1
        # 抽名稱前後嘅 HTML,再洗走標籤淨返文字
        chunk = html[max(0, idx - 700): idx + 700]
        sub = TextExtractor()
        sub.feed(chunk)
        around = [x for x in sub.text().split("\n") if x][:14]
        print(f"   gosa: {' | '.join(around)}")

    print(f"\n喺 gosa 頁面搵到名稱嘅店: {hits}/{min(15, len(stores))}")

    # 統計 gosa 頁面出現嘅純數字,同官方兩個欄位嘅集合比較,睇邊個對得上
    page_nums = set()
    for l in lines:
        for m in re.findall(r"\b\d{1,3}\b", l):
            page_nums.add(int(m))

    wait_vals = {s.get("wait") for s in stores if isinstance(s.get("wait"), int)}
    group_vals = {s.get("waitingGroup") for s in stores if isinstance(s.get("waitingGroup"), int)}

    print()
    print("=" * 78)
    print("數字集合對照(睇 gosa 顯示緊邊個欄位)")
    print("=" * 78)
    print(f"  gosa 頁面出現嘅數字個數: {len(page_nums)}")
    print(f"  官方 wait 值命中 gosa 頁面: {len(wait_vals & page_nums)}/{len(wait_vals)}")
    print(f"  官方 waitingGroup 值命中 gosa 頁面: {len(group_vals & page_nums)}/{len(group_vals)}")
    print(f"  wait 值樣本: {sorted(wait_vals)[:20]}")
    print(f"  waitingGroup 值樣本: {sorted(group_vals)[:20]}")


if __name__ == "__main__":
    main()
