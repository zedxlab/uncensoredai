const APIS = {
  chat: "https://wormgpt.freeapihub.workers.dev/chat",
  dalle: "https://zade-dalle-api.vercel.app/api/dalle",
  nsfw_pussy: "https://zade-api-hub.vercel.app/api/nsfw/pussy",
  nsfw_blowjob: "https://zade-api-hub.vercel.app/api/nsfw/blowjob",
  nsfw_milf: "https://zade-api-hub.vercel.app/api/nsfw/milf",
  nsfw_cuckold: "https://zade-api-hub.vercel.app/api/nsfw/cuckold",
};

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { type, q } = req.query;

  if (!type || !APIS[type]) {
    return res.status(400).json({ error: "Invalid or missing 'type' param. Valid: chat, dalle, nsfw_pussy, nsfw_blowjob, nsfw_milf, nsfw_cuckold" });
  }

  try {
    let targetUrl = APIS[type];

    // Append query param if needed
    if (type === "chat" && q) {
      targetUrl += `?q=${encodeURIComponent(q)}`;
    } else if (type === "dalle" && q) {
      targetUrl += `?q=${encodeURIComponent(q)}`;
    }
    // nsfw endpoints don't need a query param

    const isImage = type !== "chat";

    const upstream = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ZedCore/1.0)",
        Accept: isImage ? "image/*,*/*;q=0.9" : "application/json, text/plain, */*",
      },
    });

    const contentType = upstream.headers.get("content-type") || "";

    // If upstream returned image bytes directly (or it's an image type request)
    if (contentType.includes("image/") || (isImage && !contentType.includes("json") && !contentType.includes("text"))) {
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType || "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(Buffer.from(buffer));
    }

    // For image types that returned a redirect or URL in JSON — follow it
    if (isImage) {
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { result: text }; }
      const imgUrl = data.image || data.imageUrl || data.url || data.link || data.result || data.data?.url;
      if (imgUrl) {
        // Fetch and pipe the actual image
        const imgRes = await fetch(imgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        const imgBuf = await imgRes.arrayBuffer();
        const imgCT = imgRes.headers.get("content-type") || "image/jpeg";
        res.setHeader("Content-Type", imgCT);
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(Buffer.from(imgBuf));
      }
      return res.status(502).json({ error: "No image returned from upstream" });
    }

    // Try JSON
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Raw text response — wrap it
      data = { result: text };
    }

    // Normalise to a consistent shape so the frontend doesn't have to guess
    const normalized = normalize(type, data);
    return res.status(upstream.status).json(normalized);

  } catch (err) {
    console.error("[ZedCore Proxy Error]", err);
    return res.status(500).json({ error: "Proxy fetch failed", detail: err.message });
  }
};

/**
 * Normalize upstream responses to a consistent shape:
 *   chat  → { reply: "..." }
 *   dalle → { imageUrl: "..." }
 *   nsfw_* → { imageUrl: "..." }
 */
function normalize(type, data) {
  if (type === "chat") {
    const reply =
      data.response ||
      data.reply ||
      data.message ||
      data.text ||
      data.answer ||
      data.content ||
      (typeof data === "string" ? data : JSON.stringify(data));
    return { reply };
  }

  // image types
  const imageUrl =
    data.image ||
    data.imageUrl ||
    data.url ||
    data.link ||
    data.result ||
    data.data?.url ||
    data.data?.image ||
    (typeof data === "string" ? data : null);

  return { imageUrl };
}
