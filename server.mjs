import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 10000);
const htmlPath = path.join(__dirname, "public", "index.html");

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 30 * 1024 * 1024) {
        reject(new Error("圖片資料太大，請壓縮後再上傳。"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function analyzeImage(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("網站尚未設定 OPENAI_API_KEY，請到 Render 的 Environment Variables 設定。");
  }

  const branchName = payload.branchName || "AS";
  const categories = Array.isArray(payload.categories) ? payload.categories : ["上衣", "外套", "裙", "褲", "洋裝/連身", "套裝"];
  const factorText = payload.factorText || "";
  const note = payload.note || "無";

  const prompt = [
    `目前品牌支線：${branchName}`,
    "請依圖片、補充說明、以及該支線的暢滯銷因素，判斷商品品類、款式特徵與開發評分理由。",
    `補充說明：${note}`,
    `只能選品類：${categories.join("、")}。`,
    "BRA TOP/背心歸上衣，褲裙歸裙，成套販售或明顯上下成套歸套裝。",
    `支線因素：\n${factorText}`,
    "請只回 JSON：{\"title\":\"商品短名\",\"category\":\"品類\",\"features\":[\"特徵\"],\"summary\":\"一句評分解釋\"}"
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "你是 AIR SPACE 商品企劃分析助理。分類必須保守，輸出必須是合法 JSON。"
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: payload.imageDataUrl } }
          ]
        }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API 錯誤：HTTP ${response.status}`);
  }

  const content = data.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  return {
    title: parsed.title || "",
    category: parsed.category || "",
    features: Array.isArray(parsed.features) ? parsed.features : [],
    summary: parsed.summary || ""
  };
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = await fs.readFile(htmlPath, "utf8");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(html);
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, hasApiKey: Boolean(process.env.OPENAI_API_KEY) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const result = await analyzeImage(payload);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message || String(error) });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  handler(req, res).catch(error => sendJson(res, 500, { error: error.message || String(error) }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`AS style scoring web running on port ${port}`);
});
