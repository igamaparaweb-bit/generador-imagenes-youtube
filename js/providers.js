/* Conexión con los proveedores de IA: Google Gemini, OpenAI y Pollinations (gratis). */
(function () {
  const ASPECTS = {
    "16:9": { w: 1280, h: 720, openai: "1536x1024" },
    "9:16": { w: 720, h: 1280, openai: "1024x1536" },
    "1:1": { w: 1024, h: 1024, openai: "1024x1024" },
    "4:3": { w: 1024, h: 768, openai: "1536x1024" },
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Reintenta automáticamente cuando la API responde "demasiadas peticiones" o error temporal.
  async function fetchRetry(url, options, tries = 4) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      let res;
      try {
        res = await fetch(url, options);
      } catch (e) {
        lastErr = e;
        await sleep(1500 * (i + 1));
        continue;
      }
      if (res.ok) return res;
      const body = await res.text();
      lastErr = new Error(`HTTP ${res.status}: ${extractError(body)}`);
      lastErr.status = res.status;
      lastErr.body = body;
      if (res.status !== 429 && res.status < 500) throw lastErr;
      await sleep(2000 * Math.pow(2, i));
    }
    throw lastErr;
  }

  function extractError(body) {
    try {
      const j = JSON.parse(body);
      return (j.error && (j.error.message || j.error)) || body;
    } catch (e) {
      return body.slice(0, 300);
    }
  }

  function splitDataUrl(dataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    return m ? { mime: m[1], data: m[2] } : null;
  }

  function dataUrlToBlob(dataUrl) {
    const { mime, data } = splitDataUrl(dataUrl);
    const bin = atob(data);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h) % 2147483647;
  }

  /* ---------------- Imagen ---------------- */

  async function geminiImage(s, prompt, refs) {
    const parts = [{ text: prompt }];
    refs.forEach((r) => {
      const d = splitDataUrl(r.image);
      if (d) {
        parts.push({ text: `Imagen de referencia del personaje "${r.name}":` });
        parts.push({ inline_data: { mime_type: d.mime, data: d.data } });
      }
    });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.geminiImageModel)}:generateContent`;
    const makeBody = (withAspect) => ({
      contents: [{ role: "user", parts }],
      generationConfig: Object.assign(
        { responseModalities: ["TEXT", "IMAGE"] },
        withAspect ? { imageConfig: { aspectRatio: s.aspect } } : {}
      ),
    });
    const opts = (body) => ({
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": s.geminiKey },
      body: JSON.stringify(body),
    });
    let res;
    try {
      res = await fetchRetry(url, opts(makeBody(true)));
    } catch (e) {
      // Algunos modelos no aceptan imageConfig: se reintenta sin él.
      if (e.status === 400 && /imageConfig|aspect/i.test(e.body || "")) {
        res = await fetchRetry(url, opts(makeBody(false)));
      } else throw e;
    }
    const json = await res.json();
    const cand = json.candidates && json.candidates[0];
    const img = cand && cand.content && (cand.content.parts || []).find((p) => p.inlineData || p.inline_data);
    if (!img) {
      const why = (cand && cand.finishReason) || (json.promptFeedback && json.promptFeedback.blockReason) || "sin imagen";
      throw new Error(`Gemini no devolvió imagen (${why}). Prueba a reformular el prompt.`);
    }
    const d = img.inlineData || img.inline_data;
    return `data:${d.mimeType || d.mime_type || "image/png"};base64,${d.data}`;
  }

  async function openaiImage(s, prompt, refs) {
    const size = (ASPECTS[s.aspect] || ASPECTS["16:9"]).openai;
    let res;
    if (refs.length) {
      const form = new FormData();
      form.append("model", s.openaiImageModel);
      form.append("prompt", prompt);
      form.append("size", size);
      refs.forEach((r, i) => form.append("image[]", dataUrlToBlob(r.image), `ref${i}.png`));
      res = await fetchRetry("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${s.openaiKey}` },
        body: form,
      });
    } else {
      res = await fetchRetry("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.openaiKey}` },
        body: JSON.stringify({ model: s.openaiImageModel, prompt, size, n: 1 }),
      });
    }
    const json = await res.json();
    const item = json.data && json.data[0];
    if (!item) throw new Error("OpenAI no devolvió imagen.");
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    const blob = await (await fetch(item.url)).blob();
    return blobToDataUrl(blob);
  }

  async function pollinationsImage(s, prompt, refs, seed) {
    const { w, h } = ASPECTS[s.aspect] || ASPECTS["16:9"];
    const q = new URLSearchParams({ width: w, height: h, seed: seed, model: s.pollinationsModel });
    const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt.slice(0, 1800))}?${q}`;
    const res = await fetchRetry(url, { headers: { Authorization: `Bearer ${s.pollinationsKey}` } });
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) throw new Error("Pollinations no devolvió una imagen.");
    return blobToDataUrl(blob);
  }

  /**
   * Genera una imagen. refs = [{name, image(dataURL)}] con las referencias de los personajes.
   */
  function generateImage(settings, prompt, refs, seed) {
    switch (settings.provider) {
      case "gemini":
        if (!settings.geminiKey) throw new Error("Falta la clave de API de Gemini (Ajustes).");
        return geminiImage(settings, prompt, refs);
      case "openai":
        if (!settings.openaiKey) throw new Error("Falta la clave de API de OpenAI (Ajustes).");
        return openaiImage(settings, prompt, refs);
      default:
        if (!settings.pollinationsKey) throw new Error("Falta la clave de Pollinations (Ajustes). Es gratis en enter.pollinations.ai.");
        return pollinationsImage(settings, prompt, refs, seed);
    }
  }

  /* ---------------- Texto (para detectar personajes y crear prompts) ---------------- */

  async function generateText(s, prompt) {
    // Usa el proveedor elegido si tiene clave; si no, cualquier otro que la tenga.
    const keys = { gemini: s.geminiKey, openai: s.openaiKey, pollinations: s.pollinationsKey };
    const tp = keys[s.provider] ? s.provider : ["gemini", "openai", "pollinations"].find((k) => keys[k]);
    if (!tp) throw new Error("Pon una clave de Gemini, OpenAI o Pollinations en ⚙ Ajustes.");
    if (tp === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.geminiTextModel)}:generateContent`;
      const res = await fetchRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": s.geminiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
        }),
      });
      const json = await res.json();
      const parts = (json.candidates && json.candidates[0].content && json.candidates[0].content.parts) || [];
      return parts.map((p) => p.text || "").join("");
    }
    if (tp === "openai") {
      const res = await fetchRetry("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.openaiKey}` },
        body: JSON.stringify({
          model: s.openaiTextModel,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = await res.json();
      return json.choices[0].message.content;
    }
    const res = await fetchRetry("https://gen.pollinations.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.pollinationsKey}` },
      body: JSON.stringify({
        model: s.pollinationsTextModel,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const json = await res.json();
    return json.choices[0].message.content;
  }

  function parseJson(text) {
    const clean = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      return JSON.parse(clean);
    } catch (e) {
      const m = clean.match(/[\[{][\s\S]*[\]}]/);
      if (m) return JSON.parse(m[0]);
      throw new Error("La IA no devolvió un JSON válido.");
    }
  }

  async function detectCharacters(settings, script) {
    const prompt = `Analiza este guion de un vídeo de YouTube y extrae TODOS los personajes (personas, animales, criaturas o mascotas recurrentes).
Para cada uno devuelve:
- "name": nombre principal tal como aparece en el guion
- "aliases": otras formas en que el guion lo nombra (apodos, "el rey", "su madre"...), sin pronombres
- "description": descripción VISUAL muy detallada y fija para mantener la consistencia entre imágenes: edad aproximada, género, complexión, piel, cara, pelo, ojos, ropa exacta con colores, accesorios. Si el guion no lo dice, invéntalo de forma coherente con la historia.

Responde SOLO con JSON con esta forma: {"characters":[{"name":"","aliases":[],"description":""}]}

GUION:
"""${script.slice(0, 30000)}"""`;
    const json = parseJson(await generateText(settings, prompt));
    return (json.characters || json || []).filter((c) => c && c.name);
  }

  /**
   * Convierte cada fragmento del guion en la descripción de una escena visual,
   * usando el contexto completo para que las imágenes cuenten la historia.
   */
  async function scenePrompts(settings, chunks, characters, onProgress) {
    const charList = characters.map((c) => `- ${c.name}: ${c.description}`).join("\n") || "(sin personajes)";
    const BATCH = 30;
    const out = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const before = chunks.slice(Math.max(0, i - 6), i).map((c) => c.text).join(" ");
      const lines = batch.map((c, k) => `${i + k + 1}. "${c.text}"`).join("\n");
      const prompt = `Eres director de arte de vídeos de YouTube. Cada fragmento del guion se mostrará con UNA imagen.
Para cada fragmento escribe una descripción visual concreta de la escena (qué se ve, acción, lugar, plano de cámara, iluminación), en 1-2 frases.
Reglas:
- Si aparece un personaje, nómbralo por su nombre exacto; NO describas su aspecto físico (ya lo tenemos fijado).
- Mantén continuidad de lugar y tiempo entre fragmentos consecutivos.
- Si el fragmento es abstracto, crea una metáfora visual clara.
- Nunca pidas texto escrito dentro de la imagen.

PERSONAJES:
${charList}

CONTEXTO ANTERIOR: ${before || "(inicio del vídeo)"}

FRAGMENTOS:
${lines}

Responde SOLO con JSON: {"scenes":[{"n":numero,"scene":"descripción"}]} con exactamente ${batch.length} elementos.`;
      const json = parseJson(await generateText(settings, prompt));
      const scenes = json.scenes || json;
      batch.forEach((c, k) => {
        const found = scenes.find((sc) => Number(sc.n) === i + k + 1) || scenes[k];
        out.push(found ? found.scene : "");
      });
      if (onProgress) onProgress(Math.min(i + BATCH, chunks.length), chunks.length);
    }
    return out;
  }

  window.Providers = { generateImage, detectCharacters, scenePrompts, hashSeed, dataUrlToBlob, blobToDataUrl, ASPECTS };
})();
