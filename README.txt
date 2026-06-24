AS 款式評分網站部署包

這是「真正線上共用版」：
- 使用者不會看到 API Key 欄位
- 使用者只需要打開網址、上傳圖片、填補充說明、按分析
- API Key 只設定在 Render 後台的 Environment Variables

Render 部署步驟：
1. 把 as_real_web_app 這個資料夾上傳到 GitHub。
2. 到 Render 建立 New > Web Service。
3. 選你的 GitHub repo。
4. Build Command 填：npm install
5. Start Command 填：npm start
6. Environment Variables 新增：
   OPENAI_API_KEY = 你的 OpenAI API Key
   OPENAI_MODEL = gpt-4.1-mini
7. Deploy 完成後，Render 會給你一個網址。

那個 Render 網址就是大家共用的正式網頁。
