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

### 📊 分店列表
- 全港分店即時等候組數,顏色分級(綠 <10 組、黃 10–29 組、紅 ≥30 組)
- 頂部 summary:營業中幾多間、邊間最快、全港合共幾多組等緊
- 分店/地址搜尋、地區篩選、排序;⭐ 書籤置頂常去分店
- 撳分店卡可以睇到而家叫緊嘅籌號
- 每分鐘自動更新,亦可手動 refresh
- 深色玻璃質感 UI,手機優先響應式設計
- 🧪 官方 API 連接唔到時自動切換示範數據(會標明「示範」,demo queue 會自動行前方便試提醒功能)

## 本地運行

需要 Node.js 18+(零 dependency,唔使 `npm install`):

```bash
npm start
# 或者
node server.js
```

打開 http://localhost:3000

## 部署

任何可以行 Node.js 嘅平台都得,例如 Render / Railway / Fly.io:

- Start command: `node server.js`
- Port 由 `PORT` 環境變數控制(預設 3000)

> ⚠️ SushiPass API 可能會封鎖香港以外嘅 IP,建議部署喺亞洲區 server。

## 聲明

非官方網站,與壽司郎(Akindo Sushiro)無任何關係,數據僅供參考。
