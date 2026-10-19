/* Conexión con la IA de texto (Google Gemini, OpenAI o Pollinations) para detectar personajes y escribir prompts. */
(function () {
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

  function hasKey(s) {
    return !!(s.geminiKey || s.openaiKey || s.pollinationsKey);
  }

  async function generateText(s, prompt) {
    // Usa el proveedor elegido si tiene clave; si no, cualquier otro que la tenga.
    const keys = { gemini: s.geminiKey, openai: s.openaiKey, pollinations: s.pollinationsKey };
    const tp = keys[s.provider] ? s.provider : ["gemini", "openai", "pollinations"].find((k) => keys[k]);
    if (!tp) throw new Error("Para usar la IA pon una clave en ⚙ Ajustes (la de Google Gemini es gratis).");

    if (tp === "gemini") {
      const call = (model) => fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": s.geminiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
        }),
      });
      let res;
      try {
        res = await call(s.geminiTextModel);
      } catch (e) {
        // Google retira modelos y su error dice cuál usar ("...use models/gemini-X..."): se cambia solo.
        const m = e.status === 404 && /use models\/([\w.\-]+)/i.exec(e.message);
        if (!m || m[1] === s.geminiTextModel) throw e;
        res = await call(m[1]);
        s.geminiTextModel = m[1];
        if (s.onModelChange) s.onModelChange("geminiTextModel", m[1]);
      }
      const json = await res.json();
      const parts = (json.candidates && json.candidates[0].content && json.candidates[0].content.parts) || [];
      return parts.map((p) => p.text || "").join("");
    }
    const url = tp === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://gen.pollinations.ai/v1/chat/completions";
    const res = await fetchRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${keys[tp]}` },
      body: JSON.stringify({
        model: tp === "openai" ? s.openaiTextModel : s.pollinationsTextModel,
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
      throw new Error("La IA no devolvió un JSON válido. Vuelve a intentarlo.");
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

  window.Providers = { detectCharacters, scenePrompts, hasKey };
})();
