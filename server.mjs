import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 10000);
const publicDir = path.join(__dirname, "public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

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
        reject(new Error("上傳圖片資料過大，請分批分析。"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function serveFile(filePath, res) {
  const data = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Cache-Control": ext === ".json" || ext === ".html" ? "no-store" : "public, max-age=86400"
  });
  res.end(data);
}

async function serveStatic(urlPath, res) {
  const decodedPath = decodeURIComponent(urlPath.replace(/^\/+/, ""));
  const filePath = path.resolve(publicDir, decodedPath);
  const publicRoot = path.resolve(publicDir);
  if (!filePath.startsWith(publicRoot + path.sep) && filePath !== publicRoot) {
    sendJson(res, 403, { error: "Forbidden" });
    return true;
  }
  try {
    await serveFile(filePath, res);
    return true;
  } catch {
    return false;
  }
}

async function analyzeImage(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Render 尚未設定 OPENAI_API_KEY。請到 Render Environment 更新 API key 後重新部署。");
  }

  const branchName = payload.branchName || "AS";
  const categories = Array.isArray(payload.categories) ? payload.categories : ["上衣", "洋裝", "裙子", "褲子", "外套", "套裝"];
  const factorText = payload.factorText || "";
  const note = payload.note || "";

  const prompt = [
    `品牌支線：${branchName}`,
    `可選品類：${categories.join("、")}`,
    `補充說明：${note}`,
    `支線暢滯銷因素：\n${factorText}`,
    "請只回傳 JSON，不要 Markdown。",
    "JSON 格式：{\"title\":\"款式短名\",\"category\":\"品類\",\"middleCategory\":\"中分類/版型\",\"features\":[\"標籤\"],\"summary\":\"評分理由\"}",
    "請依圖片與文字辨識：罩衫、襯衫、針織、蕾絲、透膚/透紗/薄紗/網紗、鏤空/簍空、綁帶/繫帶、百褶/壓褶、格紋、條紋、波點、印花、魚尾、蛋糕裙、開衩、荷葉、不對稱、抽繩、空氣層、羅紋、牛仔、皮革/皮質。",
    "素色、長短、袖型只能當描述，不要作為主要評分元素。洋裝版型請判斷上合下寬、上合下合、上寬下寬、A字、魚尾或傘襬。"
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
        { role: "system", content: "你是 AIR SPACE 商品企劃款式分析助手，請精準辨識服裝品類與設計標籤。" },
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
    middleCategory: parsed.middleCategory || parsed.subCategory || "",
    features: Array.isArray(parsed.features) ? parsed.features : [],
    summary: parsed.summary || ""
  };
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, hasApiKey: Boolean(process.env.OPENAI_API_KEY) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      sendJson(res, 200, await analyzeImage(payload));
    } catch (error) {
      sendJson(res, 500, { error: error.message || String(error) });
    }
    return;
  }

  if (req.method === "GET") {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      await serveFile(path.join(publicDir, "index.html"), res);
      return;
    }
    if (await serveStatic(url.pathname, res)) return;
  }

  sendJson(res, 404, { error: "Not found" });
}

http.createServer((req, res) => {
  handler(req, res).catch(error => sendJson(res, 500, { error: error.message || String(error) }));
}).listen(port, "0.0.0.0", () => {
  console.log(`AIR SPACE AI running on port ${port}`);
});
