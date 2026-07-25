# 🍣 壽司郎排隊追蹤器 (shshiwaiting)

香港壽司郎分店**即時排隊等候人數**追蹤網站,參考 [sushiro-hk-tracker](https://sushiro-hk-tracker.gosa.app/) 用同一技術製作。

## 運作原理

香港壽司郎官方 App 背後係一個叫 **SushiPass** 嘅系統,佢嘅 REST API 唔使登入就可以讀到:

| Endpoint | 用途 |
|---|---|
| `GET https://sushipass.sushiro.com.hk/api/2.0/info/storelist?latitude=22.32&longitude=114.17&numresults=100&region=HK` | 全港分店資料,包括 `wait`(等候組數)、`storeStatus`(營業狀態)、地址、地區、座標 |
| `GET https://sushipass.sushiro.com.hk/api/2.0/remote/groupqueues?region=HK&storeid=<ID>` | 單一分店而家叫緊嘅籌號 (`storeQueue`) |

因為瀏覽器 CORS 限制唔可以直接 call 上面嘅 API,所以本 project 有一個好輕量嘅 Node.js proxy server (`server.js`):

```
瀏覽器 ──► /api/stores ──► server.js (cache 60秒) ──► SushiPass API
```

Server 會 cache 60 秒,避免對官方 API 造成壓力。

## 功能

### 🎫 我的籌號追蹤 + 到店提醒
- 撳分店卡嘅「追蹤籌號」,入你張飛個號碼
- 螢幕底部會有個追蹤 island:顯示而家叫到幾多號、仲差幾多組、進度條、粗略估計時間
- 每 20 秒自動 check 一次,可以揀「差 3 / 5 / 8 / 12 組時」提醒
- 提醒方式:瀏覽器通知(Notification API)+ 提示音(WebAudio)+ 震動(手機)+ 分頁標題更新
- 叫到你個號會再嚟一次「🍣 到你喇!」大通知
- 追蹤狀態存喺 localStorage,refresh 頁面唔會唔見

### 📍 附近 / ♥ 喜愛
- 「附近」tab:攞一次定位(唔會儲存或上傳),計出每間店距離,由近到遠排,卡上顯示「X 米 / X.X km」
- 「喜愛」tab:撳分店卡嘅 ♡ 加入喜愛,一眼睇晒常去嗰幾間;喜愛店喺「全部」都會置頂
- 展開分店卡有「地圖 ↗」link,一撳直接開 Google Maps 導航

### 📊 分店列表
- 全港分店即時等候組數,顏色分級(綠 <10 組、黃 10–29 組、紅 ≥30 組)
- 頂部 summary:營業中幾多間、邊間最快、全港合共幾多組等緊
- 分店/地址搜尋、地區篩選、排序;⭐ 書籤置頂常去分店
- 撳分店卡可以睇到而家叫緊嘅籌號
- 每分鐘自動更新,亦可手動 refresh
- 深色玻璃質感 UI + ☀️ 淺色主題(跟系統預設,右上角可以手動切換,揀咗會記住)

### ⚠️ 數據誠實原則
呢個 app 嘅數字係用嚟決定去唔去食飯,所以寧願冇數據都好過俾個似層層嘅假數:

- **絕不用假數據頂上**:官方 API 連唔到就顯示錯誤畫面同失敗原因,唔會顯示任何數字
- **示範數據要明確開啟**:淨係 `?demo=1` 先會出,而且橫額寫明「全部數字都係假,唔好信」,並且**唔會發任何提醒**
- **未知等候人數顯示「?」**:官方冇回傳 `wait` 嗰陣顯示斜紋「冇數據」,唔會當 0 扮綠色
- **標明數據幾舊**:標題下面顯示會跳動嘅「X 秒前 · 來源」,超過 90 秒變黃、4.5 分鐘變紅
- **唔亂估時間**:等候時間用實際觀察到嘅叫號速度計,樣本不足(少於 3 組 / 2 分鐘)就唔顯示

### 📲 PWA
- 可以「加至主畫面」當 app 用(manifest + service worker + 自家 icon)
- 靜態資源離線 cache,排隊數據永遠行網絡攞最新
- 注意:iOS 上通知要 iOS 16.4+ 並且加咗主畫面先收到;真正「閂晒 app 都收到」嘅 background push 需要 push server,暫未包括

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
前端會自動 fallback 用公共 CORS proxy 直連 SushiPass API(同原網站一樣嘅技術):

```
同源 /api/stores(有 Node proxy 時)
  ↓ 唔得就
corsproxy.io → SushiPass
  ↓ 唔得就
cors.freehi.workers.dev → SushiPass
  ↓ 全部唔得
示範數據模式
```

如果 workflow 行完但頁面未出,去 repo **Settings → Pages** 確認 Source 係「GitHub Actions」。

### 自己 host(Node)

任何可以行 Node.js 嘅平台都得,例如 Render / Railway / Fly.io:

- Start command: `node server.js`
- Port 由 `PORT` 環境變數控制(預設 3000)

> ⚠️ SushiPass API 可能會封鎖香港以外嘅 IP:你喺香港用瀏覽器開 Pages 版係經你自己/CF 邊緣節點,一般冇問題;但海外 server host 就可能收 403,建議揀亞洲區。

## 聲明

非官方網站,與壽司郎(Akindo Sushiro)無任何關係,數據僅供參考。
