// Vercel serverless function: the ONLY place the API key lives (env var ANTHROPIC_API_KEY).
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM = "You are Think1.0, a helpful, honest and concise AI assistant. Use markdown for code. Do not volunteer which underlying model or company powers you.";
const SVG_RULES = ' Output ONLY the SVG code, no explanation and no markdown fences. Root element: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">. Be detailed and beautiful: layered shapes, gradients, soft shading, a pleasing pastel-friendly palette unless the request says otherwise. No scripts, no external images or fonts, no foreignObject. Use text only if requested (font-family sans-serif).';
const GEN_SPEC = {
  image: "Create a high-quality vector illustration as a single SVG." + SVG_RULES,
  video: "Create a short looping animated video scene (about 8 seconds, seamless loop) as a single SVG. Use SMIL (<animate>, <animateTransform>, <animateMotion>, repeatCount=\"indefinite\") and/or CSS @keyframes inside a <style> element in the SVG. Combine several coordinated motions (moving objects, changing light or sky, camera-like drift) so it feels like a tiny film." + SVG_RULES,
};

// Simple per-IP limiter (in memory: resets when the function restarts; see README for a stronger option).
const hits = new Map();
function limited(ip, kind) {
  const limit = kind === "chat" ? +(process.env.CHAT_PER_HOUR || 40) : +(process.env.GEN_PER_HOUR || 10);
  const key = ip + ":" + kind, now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < 3600000);
  if (arr.length >= limit) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 3600000) hits.delete(k);
  return false;
}

const IMG_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
function toImageBlocks(images) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, 3).map(src => {
    const m = typeof src === "string" && src.length < 1500000 && IMG_RE.exec(src);
    return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : null;
  }).filter(Boolean);
}
const fail = (res, code, msg) => res.status(code).json({ error: msg });

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "Method not allowed.");
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed && req.headers.origin && req.headers.origin !== allowed) return fail(res, 403, "Forbidden.");
  if (!process.env.ANTHROPIC_API_KEY) return fail(res, 500, "The server is not configured yet.");

  const b = req.body && typeof req.body === "object" ? req.body : {};
  const mode = ["chat", "image", "video"].includes(b.mode) ? b.mode : null;
  if (!mode) return fail(res, 400, "Bad request.");

  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  if (limited(ip, mode === "chat" ? "chat" : "gen"))
    return fail(res, 429, "You've reached the hourly limit. Please try again a little later.");

  let system, messages, maxTokens;
  const images = toImageBlocks(b.images);
  if (mode === "chat") {
    const list = Array.isArray(b.messages) ? b.messages.slice(-30) : [];
    messages = list.map(m => ({ role: m && m.role === "assistant" ? "assistant" : "user", content: String((m && m.content) || "").slice(0, 8000) }))
                   .filter(m => m.content);
    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== "user") return fail(res, 400, "Bad request.");
    if (images.length) { const last = messages[messages.length - 1]; last.content = [...images, { type: "text", text: last.content }]; }
    const name = String(b.name || "").replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 30);
    system = SYSTEM + (name ? `\nThe user's name is ${name}.` : "");
    maxTokens = 2000;
  } else {
    const prompt = String(b.prompt || "").slice(0, 1000).trim();
    if (!prompt) return fail(res, 400, "Bad request.");
    const text = GEN_SPEC[mode] + (images.length ? "\nUse the attached image(s) as visual reference." : "") + "\n\nRequest: " + prompt;
    messages = [{ role: "user", content: [...images, { type: "text", text }] }];
    system = SYSTEM;
    maxTokens = 6000;
  }

  let upstream;
  try {
    upstream = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages, stream: true }),
    });
  } catch (e) { console.error("upstream fetch failed", e); return fail(res, 502, "The AI service is unreachable. Please try again."); }

  if (!upstream.ok) {
    console.error("upstream error", upstream.status, await upstream.text().catch(() => ""));
    return fail(res, upstream.status === 429 ? 503 : 502, "The AI is busy right now. Please try again in a moment.");
  }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  const reader = upstream.body.getReader();
  res.on("close", () => { try { reader.cancel(); } catch {} });
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); }
  } catch {}
  res.end();
};
