# shshiwaiting — 專案慣例

## Commit 訊息

**唔好加 `Claude-Session:` 或者任何 chat / session 連結。** 呢個 repo 係公開嘅,
對話連結唔應該出現喺 GitHub 上面。`Co-Authored-By:` 可以保留。

## 數據誠實原則

呢個 app 嘅數字係用嚟決定去唔去食飯,錯數據會令人白行一趟。所以:

1. **絕不用假數據頂上。** 攞唔到就顯示錯誤畫面同失敗原因,唔顯示任何數字。
   示範數據淨係 `?demo=1` 先出,而且要明確標示、唔會發任何提醒。
2. **攞唔到 ≠ 零。** 網絡失敗要顯示「攞唔到」,唔可以扮「冇人排隊」或者當 0 計。
3. **未經實測就唔好寫死。** 任何關於官方 API 欄位語意嘅假設,都要喺
   `.github/workflows/api-probe.yml` 實際打一次驗證,唔可以靠第三方專案推測。
   開發環境嘅網絡政策連唔到官方 API,所以呢啲驗證一律喺 GitHub runner 上面做。

## 官方 API 欄位(2026-07-25 runner 實測)

| 欄位 | 意思 | 範圍 |
|---|---|---|
| `waitingGroup` | 等緊嘅**組**數 — 介面主要顯示嘅就係佢 | 0 ~ 122 |
| `wait` | 預計等候**分鐘**數,5 的倍數(`waitTimeCap`=180) | 0 ~ 210 |
| `area` | 18 區議會分區名(油尖旺區…),唔係「九龍/新界/港島」 | — |
| `distance` | 用 query 座標計,**唔係**用戶位置 | — |

- `wait` **唔係**組數。康城店 `wait=210` / `waitingGroup=106`。
  第三方專案 `angus6b23/sushiro-vue` 將 `wait` 當組數,係錯嘅,唔好參考。
- 籌號係零填充字串,可帶後綴(實測 `["069-1","069-2","070"]`)。
  一律用 `parseTicket()` 拆,**唔可以**用 `replace(/\D/g,'')` —— 會將 `069-1` 變成 691。
- `reservationQueue`(例如 `"8120"`)係另一個系列,唔可以撈埋落現場籌。
- 官方 API **冇**封鎖香港以外 IP(San Jose runner 實測 200)。

## 驗證

改動涉及顯示數字或者追蹤邏輯,一律要:
- 用真實 API 值(唔係自己作嘅 mock)做 fixture 跑 headless browser 測試
- 需要嘅話同參考站 `sushiro-hk-tracker.gosa.app` 並排比對
  (見 `scripts/compare_gosa.py`;佢係 Livewire SSR,冇 JSON API,只能用嚟驗證語意)
