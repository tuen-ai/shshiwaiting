# 🍣 壽司郎排隊追蹤器 (shshiwaiting)

香港壽司郎分店**即時排隊等候人數**追蹤網站。

## 運作原理(2026-07-25 GitHub Actions runner 實測確認)

開發環境嘅網絡政策連唔到官方 API,所以所有欄位語意都係喺 GitHub runner 上面
實際打一次官方 API 驗證返嚟(見 `.github/workflows/api-probe.yml`),
唔係靠任何第三方專案嘅解讀。

| Endpoint | 回傳 |
|---|---|
| `GET https://sushipass.sushiro.com.hk/api/2.0/info/storelist?latitude=22.32&longitude=114.17&numresults=100&region=HK` | 裸 JSON array,實測 **44 間**分店 |
| `GET https://sushipass.sushiro.com.hk/api/2.0/remote/groupqueues?region=HK&storeid=<ID>` | 多條隊列 + `separateQueue` 旗標 |

實測確認嘅欄位語意:

| 欄位 | 意思 | 實測範圍 |
|---|---|---|
| `waitingGroup` | **等緊嘅「組」數** — 介面主要顯示嘅就係佢 | 0 ~ 122 |
| `wait` | **預計等候「分鐘」數**,全部係 5 嘅倍數(`waitTimeCap`=180) | 0 ~ 210 |
| `storeStatus` | 營業狀態 | 實測全部 `OPEN` |
| `area` | 18 區議會分區名(油尖旺區、沙田區…),唔係「九龍/新界/港島」 | — |
| `distance` | 字串,用 query 傳入嘅座標計,**唔係**用戶位置 | — |
| `storeQueue` 等 | 零填充字串,可帶後綴(實測 `["069-1","069-2","070"]`) | — |

> `wait` 唔係組數。例:康城店 `wait=210` / `waitingGroup=106`;黃大仙店 `wait=5` / `waitingGroup=1`。
> 將 `wait` 當成組數會誤差接近一倍。

### 同參考站交叉驗證

同一時間攞 [sushiro-hk-tracker.gosa.app](https://sushiro-hk-tracker.gosa.app/) 渲染出嚟嘅頁面
逐間店比對(見 `.github/workflows/gosa-probe.yml` + `scripts/compare_gosa.py`):

| 店 | gosa.app 顯示 | `wait` | `waitingGroup` |
|---|---|---|---|
| 旺角店 | 31組人等緊 | 30 | **31** ✅ |
| 旺角東Moko店 | 74組人等緊 | 60 | **74** ✅ |
| 黃埔時尚坊店 | 16組人等緊 | 35 | **16** ✅ |
| 樂富店 | 7組人等緊 | 10 | **7** ✅ |

14 間店入面 13 間完全命中 `waitingGroup`(餘下一間差 2,係抓取時間差),同 `wait` 完全對唔上。
gosa.app 係 Laravel + Livewire 伺服器端渲染,`wire:poll.10s` 每 10 秒刷新,
**冇 client 側 JSON API**(JS bundle 零命中、11 條 API 路徑全部 404),
所以只能用嚟驗證語意,唔可以直接消費。

### 數據路徑

```
瀏覽器 ──► /api/stores ──► server.js (cache 15秒) ──► SushiPass API
```

靜態部署(GitHub Pages)冇 server,前端會順序試:
同源 proxy → 官方直連 → cors.freehi.workers.dev → corsproxy.io。
實測結果:freehi worker **200 ✅**、corsproxy.io **403**(要付費 plan)、allorigins **500**。
全部失敗就顯示錯誤畫面同逐個來源嘅失敗原因,**唔會顯示任何數字**。

## 功能

### 🎫 我的籌號追蹤 + 到店提醒
- 撳分店卡嘅「追蹤籌號」,入你張飛個號碼
- 螢幕底部會有個追蹤 island:顯示而家叫到幾多號、仲差幾多組、進度條、粗略估計時間
- 每 12 秒自動 check 一次,可以揀「差 3 / 5 / 8 / 12 組時」提醒
- 提醒方式:瀏覽器通知(Notification API)+ 提示音(WebAudio)+ 震動(手機)+ 分頁標題更新
- 叫到你個號會再嚟一次「🍣 到你喇!」大通知
- 追蹤狀態存喺 localStorage,refresh 頁面唔會唔見

### 📍 附近 / ♥ 喜愛
- 「附近」tab:攞一次定位(唔會儲存或上傳),計出每間店距離,由近到遠排,卡上顯示「X 米 / X.X km」
- 「喜愛」tab:撳分店卡嘅 ♡ 加入喜愛,一眼睇晒常去嗰幾間;喜愛店喺「全部」都會置頂
- 展開分店卡有「地圖 ↗」link,一撳直接開 Google Maps 導航

### 📊 分店列表
- 全港 44 間分店即時等候組數(`waitingGroup`),顏色分級(綠 <10 組、黃 10–29 組、紅 ≥30 組)
- 副行顯示官方預計等候時間(`wait`,分鐘),兩個數字各自標明單位
- 頂部 summary:營業中幾多間、邊間最快、全港合共幾多組等緊
- 分店/地址搜尋、地區篩選、排序;⭐ 書籤置頂常去分店
- 撳分店卡可以睇到而家叫緊嘅籌號
- 每 15 秒自動更新(參考站係 10 秒),亦可手動 refresh
- 深色玻璃質感 UI + ☀️ 淺色主題(跟系統預設,右上角可以手動切換,揀咗會記住)

### ⚠️ 數據誠實原則
呢個 app 嘅數字係用嚟決定去唔去食飯,所以寧願冇數據都好過俾個似層層嘅假數:

- **絕不用假數據頂上**:官方 API 連唔到就顯示錯誤畫面同失敗原因,唔會顯示任何數字
- **示範數據要明確開啟**:淨係 `?demo=1` 先會出,而且橫額寫明「全部數字都係假,唔好信」,並且**唔會發任何提醒**
- **未知等候人數顯示「?」**:官方冇回傳 `waitingGroup` 嗰陣顯示斜紋「冇數據」,唔會當 0 扮綠色
- **攞唔到 ≠ 冇人排**:籌號 API 失敗顯示「⚠️ 攞唔到籌號數據」,唔會用網絡錯誤扮「零人排隊」
- **隔夜舊籌會停低**:籌號每日重置,唔會靜靜攞舊籌喺第二日誤報「到你喇」
- **店舖收工會講明**:`storeStatus` 唔係 OPEN 就停止倒數同提醒
- **標明數據幾舊**:標題下面顯示會跳動嘅「X 秒前 · 來源」,超過 60 秒變黃、3 分鐘變紅
- **唔亂估時間**:等候時間用實際觀察到嘅叫號速度計,樣本不足(少於 3 組 / 2 分鐘)就唔顯示

### 📲 PWA
- 可以「加至主畫面」當 app 用(manifest + service worker + 自家 icon)
- 靜態資源離線 cache,排隊數據永遠行網絡攞最新
- ⚠️ 提醒靠前景計時器:手機鎖屏或者切走太耐,系統會凍結 timer 令提醒遲到。
  返到 app 會即刻補做一次,但唔應該完全依賴 —— sheet 上面有寫明。
- iOS 通知要 16.4+ 並且加咗主畫面先收到;真正「閂晒 app 都收到」嘅 background push 需要 push server,暫未包括

## 本地運行

需要 Node.js 18+(零 dependency,唔使 `npm install`):

```bash
npm start
# 或者
node server.js
```

打開 http://localhost:3000

## 部署

### GitHub Pages(靜態,已設定自動部署)

`.github/workflows/pages.yml` 會自動將 `public/` 部署上 GitHub Pages。因為 Pages 冇 server,
前端會自動 fallback 用公共 CORS proxy 直連 SushiPass API:

```
同源 /api/stores(有 Node proxy 時)
  ↓ 唔得就
官方直連(同源部署 / 官方開咗 CORS 時)
  ↓ 唔得就
cors.freehi.workers.dev → SushiPass    (實測 200 ✅)
  ↓ 唔得就
corsproxy.io → SushiPass               (實測 403,要付費 plan)
  ↓ 全部唔得
顯示錯誤畫面 + 逐個來源嘅失敗原因(唔會顯示任何數字)
```

如果 workflow 行完但頁面未出,去 repo **Settings → Pages** 確認 Source 係「GitHub Actions」。

### 自己 host(Node)

任何可以行 Node.js 嘅平台都得,例如 Render / Railway / Fly.io:

- Start command: `node server.js`
- Port 由 `PORT` 環境變數控制(預設 3000)

> ℹ️ 官方 API **冇**封鎖香港以外 IP —— GitHub runner(San Jose)實測攞到 HTTP 200。
> 開發環境嘅 403 純粹係該環境自己嘅網絡政策。
> 如果連唔到,錯誤畫面會列出每個來源嘅失敗原因;最穩陣係自己起一個
> Cloudflare Worker 做 proxy,代替公共 CORS proxy。

## 聲明

非官方網站,與壽司郎(Akindo Sushiro)無任何關係,數據僅供參考。
