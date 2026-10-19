/* Lógica principal de la app. */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STYLE_PRESETS = {
    "Cine realista": "Fotograma cinematográfico realista, iluminación dramática, alto detalle, profundidad de campo, colores ricos",
    "Animación 3D": "Estilo animación 3D tipo Pixar, personajes expresivos, iluminación suave, colores vivos",
    "Anime": "Estilo anime de alta calidad, líneas limpias, colores vibrantes, fondo detallado",
    "Cómic": "Ilustración estilo cómic, tinta marcada, colores planos intensos, sombreado dramático",
    "Acuarela": "Ilustración en acuarela, trazos suaves, papel texturizado, paleta cálida",
    "Documental histórico": "Pintura histórica al óleo, realista, luz de época, atmósfera documental",
    "Terror": "Atmósfera oscura de terror, niebla, iluminación tenue y fría, alto contraste, cinematográfico",
  };

  const DEFAULT_SETTINGS = {
    provider: "gemini",
    aspect: "16:9",
    geminiKey: "",
    openaiKey: "",
    geminiImageModel: "gemini-2.5-flash-image",
    geminiTextModel: "gemini-2.5-flash",
    openaiImageModel: "gpt-image-1",
    openaiTextModel: "gpt-4.1-mini",
    pollinationsKey: "",
    pollinationsModel: "black-forest-labs/flux.1-schnell",
    pollinationsTextModel: "openai/gpt-5.4-nano",
    concurrency: 2,
    seed: 4242,
    autoRefs: true,
    style: STYLE_PRESETS["Cine realista"],
  };

  let settings = Storage2.getSettings(DEFAULT_SETTINGS);
  let state = emptyState();
  let running = false;
  let stopRequested = false;

  function emptyState() {
    return { script: "", minWords: 3, maxWords: 5, wpm: 150, carry: true, characters: [], chunks: [] };
  }

  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad = (n, len = 3) => String(n).padStart(len, "0");

  /* ---------------- Guardado ---------------- */

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Storage2.idbSet("project", state), 400);
  }

  function saveSettings() {
    Storage2.setSettings(settings);
  }

  /* ---------------- Utilidades UI ---------------- */

  let toastTimer = null;
  function toast(msg, isError) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("err", !!isError);
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), isError ? 7000 : 3500);
  }

  function setImg(img, src) {
    if (src) img.src = src;
    else img.removeAttribute("src");
  }

  function showTab(name) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  }

  async function withBusy(btn, fn) {
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "⏳ Trabajando...";
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }

  function download(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function fmtTime(sec, srt) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec % 1) * 1000);
    if (srt) return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
    return `${h ? h + ":" : ""}${pad(m, 2)}:${pad(s, 2)}`;
  }

  function timings() {
    let words = 0;
    const perWord = 60 / (state.wpm || 150);
    return state.chunks.map((c) => {
      const start = words * perWord;
      words += c.words;
      return { start, end: words * perWord };
    });
  }

  function charById(id) {
    return state.characters.find((c) => c.id === id);
  }

  /* ---------------- Ajustes ---------------- */

  const SETTING_FIELDS = [
    "provider", "aspect", "geminiKey", "openaiKey", "geminiImageModel", "geminiTextModel",
    "openaiImageModel", "openaiTextModel", "pollinationsKey", "pollinationsModel", "pollinationsTextModel", "concurrency", "seed", "style",
  ];

  function bindSettings() {
    SETTING_FIELDS.forEach((key) => {
      const el = $("#" + key);
      el.value = settings[key];
      el.addEventListener("change", () => {
        settings[key] = el.type === "number" ? Number(el.value) : el.value.trim();
        saveSettings();
        if (key === "aspect") applyAspect();
      });
    });
    const auto = $("#autoRefs");
    auto.checked = settings.autoRefs;
    auto.addEventListener("change", () => {
      settings.autoRefs = auto.checked;
      saveSettings();
    });

    const presets = $("#stylePresets");
    Object.entries(STYLE_PRESETS).forEach(([name, text]) => {
      const b = document.createElement("button");
      b.className = "btn small style-chip";
      b.textContent = name;
      b.addEventListener("click", () => {
        $("#style").value = text;
        settings.style = text;
        saveSettings();
      });
      presets.appendChild(b);
    });
    applyAspect();
  }

  function applyAspect() {
    const [w, h] = settings.aspect.split(":");
    $$(".scene-img").forEach((el) => (el.style.aspectRatio = `${w} / ${h}`));
  }

  /* ---------------- Guion ---------------- */

  function bindScript() {
    const script = $("#script");
    bindScriptValues();

    script.addEventListener("input", () => {
      state.script = script.value;
      updateScriptStats();
      save();
    });
    ["minWords", "maxWords", "wpm"].forEach((k) =>
      $("#" + k).addEventListener("change", (e) => {
        state[k] = Number(e.target.value) || state[k];
        updateScriptStats();
        save();
        if (k === "wpm") renderScenes();
      })
    );
    $("#carry").addEventListener("change", (e) => {
      state.carry = e.target.checked;
      save();
    });

    $("#btnSplit").addEventListener("click", splitScript);
    $("#btnDetect").addEventListener("click", (e) => withBusy(e.currentTarget, detectCharacters));
    $("#btnDetect2").addEventListener("click", (e) => withBusy(e.currentTarget, detectCharacters));
  }

  function updateScriptStats() {
    const n = state.script.trim() ? state.script.trim().split(/\s+/).length : 0;
    const avg = (state.minWords + state.maxWords) / 2;
    const mins = n / (state.wpm || 150);
    $("#scriptStats").textContent = `${n} palabras · ~${Math.ceil(n / avg)} imágenes · ~${mins.toFixed(1)} min de vídeo`;
  }

  function splitScript() {
    if (!state.script.trim()) return toast("Primero pega el guion.", true);
    if (state.chunks.some((c) => c.image) && !confirm("Ya hay imágenes generadas. ¿Volver a dividir el guion? Se perderán las escenas actuales.")) return;
    const chunks = Splitter.splitScript(state.script, state.minWords, state.maxWords).map((c) => ({
      id: uid(),
      text: c.text,
      sentence: c.sentence,
      words: c.words,
      scene: "",
      image: null,
      variant: 0,
      error: null,
    }));
    Splitter.assignCharacters(chunks, state.characters, state.carry);
    state.chunks = chunks;
    save();
    renderScenes();
    showTab("escenas");
    toast(`Guion dividido en ${chunks.length} escenas.`);
  }

  function reassignCharacters() {
    if (!state.chunks.length) return;
    Splitter.assignCharacters(state.chunks, state.characters, state.carry);
    renderScenes();
  }

  async function detectCharacters() {
    if (!state.script.trim()) throw new Error("Primero pega el guion.");
    const found = await Providers.detectCharacters(settings, state.script);
    let added = 0;
    found.forEach((f) => {
      const existing = state.characters.find((c) => Splitter.normalize(c.name) === Splitter.normalize(f.name));
      if (existing) {
        if (!existing.description) existing.description = f.description || "";
        return;
      }
      state.characters.push({
        id: uid(),
        name: f.name,
        aliases: Array.isArray(f.aliases) ? f.aliases : [],
        description: f.description || "",
        image: null,
      });
      added++;
    });
    save();
    renderCharacters();
    reassignCharacters();
    showTab("personajes");
    toast(added ? `Se encontraron ${added} personajes nuevos.` : "No se encontraron personajes nuevos.");
  }

  /* ---------------- Personajes ---------------- */

  function renderCharacters() {
    const wrap = $("#characters");
    wrap.innerHTML = "";
    $("#charCount").textContent = state.characters.length;
    if (!state.characters.length) {
      wrap.innerHTML = `<p class="muted">Aún no hay personajes. Usa "Detectar con IA" o añádelos a mano.</p>`;
      return;
    }
    state.characters.forEach((ch) => wrap.appendChild(charCard(ch)));
  }

  function charCard(ch) {
    const el = $("#tplChar").content.firstElementChild.cloneNode(true);
    el.dataset.id = ch.id;
    setImg($("img", el), ch.image);
    const name = $(".c-name", el);
    const aliases = $(".c-aliases", el);
    const desc = $(".c-desc", el);
    name.value = ch.name;
    aliases.value = (ch.aliases || []).join(", ");
    desc.value = ch.description;

    name.addEventListener("change", () => {
      ch.name = name.value.trim();
      save();
      reassignCharacters();
    });
    aliases.addEventListener("change", () => {
      ch.aliases = aliases.value.split(",").map((a) => a.trim()).filter(Boolean);
      save();
      reassignCharacters();
    });
    desc.addEventListener("change", () => {
      ch.description = desc.value.trim();
      save();
    });
    $(".c-gen", el).addEventListener("click", (e) =>
      withBusy(e.currentTarget, async () => {
        if (ch.image && !confirm(`¿Reemplazar la referencia de ${ch.name}? Las escenas ya generadas no cambiarán.`)) return;
        await generateCharacterRef(ch);
      })
    );
    $(".c-upload", el).addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      ch.image = await Providers.blobToDataUrl(file);
      setImg($("img", el), ch.image);
      save();
    });
    $(".c-del", el).addEventListener("click", () => {
      if (!confirm(`¿Eliminar a ${ch.name || "este personaje"}?`)) return;
      state.characters = state.characters.filter((c) => c !== ch);
      state.chunks.forEach((c) => (c.characters = (c.characters || []).filter((id) => id !== ch.id)));
      save();
      renderCharacters();
      renderScenes();
    });
    return el;
  }

  function addCharacter() {
    state.characters.push({ id: uid(), name: "Nuevo personaje", aliases: [], description: "", image: null });
    save();
    renderCharacters();
    const cards = $$("#characters .char");
    const last = cards[cards.length - 1];
    $(".c-name", last).select();
  }

  async function generateCharacterRef(ch) {
    if (!ch.description) throw new Error(`Escribe una descripción para ${ch.name} antes de generar su referencia.`);
    const card = $(`#characters .char[data-id="${ch.id}"]`);
    const spinner = card && $(".spinner", card);
    if (spinner) spinner.classList.remove("hidden");
    try {
      const prompt = `${settings.style}.
Hoja de referencia de personaje: ${ch.name}. ${ch.description}.
Un solo personaje, cuerpo entero, de pie, mirando a cámara, fondo liso gris claro, iluminación uniforme. Sin texto ni marcas de agua.`;
      ch.image = await Providers.generateImage(
        Object.assign({}, settings, { aspect: "1:1" }),
        prompt,
        [],
        Providers.hashSeed(ch.name) + settings.seed
      );
      save();
      if (card) setImg($("img", card), ch.image);
    } finally {
      if (spinner) spinner.classList.add("hidden");
    }
  }

  async function generateMissingRefs(onlyUsed) {
    const usedIds = new Set(state.chunks.flatMap((c) => c.characters || []));
    const todo = state.characters.filter((c) => !c.image && c.description && (!onlyUsed || usedIds.has(c.id)));
    for (const ch of todo) {
      if (stopRequested) return;
      $("#progressText").textContent = `Creando referencia de ${ch.name}...`;
      await generateCharacterRef(ch);
    }
    return todo.length;
  }

  /* ---------------- Escenas ---------------- */

  function renderScenes() {
    const wrap = $("#scenes");
    wrap.innerHTML = "";
    $("#sceneCount").textContent = state.chunks.length;
    const times = timings();
    const frag = document.createDocumentFragment();
    state.chunks.forEach((chunk, i) => frag.appendChild(sceneCard(chunk, i, times[i])));
    wrap.appendChild(frag);
    applyAspect();
    updateProgress();
  }

  function sceneCard(chunk, i, time) {
    const el = $("#tplScene").content.firstElementChild.cloneNode(true);
    el.dataset.id = chunk.id;
    $(".s-num", el).textContent = `#${i + 1}`;
    $(".s-time", el).textContent = `${fmtTime(time.start)} – ${fmtTime(time.end)}`;
    $(".s-text", el).textContent = `“${chunk.text}”`;
    const sceneInput = $(".s-scene", el);
    sceneInput.value = chunk.scene || "";
    sceneInput.addEventListener("change", () => {
      chunk.scene = sceneInput.value.trim();
      save();
    });

    const chips = $(".s-chars", el);
    state.characters.forEach((ch) => {
      const b = document.createElement("button");
      const on = (chunk.characters || []).includes(ch.id);
      b.className = "chip" + (on ? " on" : "") + (on && chunk.inherited ? " inherited" : "");
      b.textContent = ch.name;
      b.title = on && chunk.inherited ? "Heredado del fragmento anterior (clic para quitar)" : "Clic para añadir/quitar de esta escena";
      b.addEventListener("click", () => {
        const set = new Set(chunk.characters || []);
        set.has(ch.id) ? set.delete(ch.id) : set.add(ch.id);
        chunk.characters = Array.from(set);
        chunk.inherited = false;
        b.classList.toggle("on", set.has(ch.id));
        b.classList.remove("inherited");
        save();
      });
      chips.appendChild(b);
    });

    $(".s-gen", el).addEventListener("click", (e) =>
      withBusy(e.currentTarget, async () => {
        if (chunk.image) chunk.variant = (chunk.variant || 0) + 1;
        await generateScene(chunk);
        updateProgress();
      })
    );
    $(".s-dl", el).addEventListener("click", () => {
      if (!chunk.image) return toast("Esta escena aún no tiene imagen.", true);
      download(`${pad(i + 1)}.png`, Providers.dataUrlToBlob(chunk.image));
    });
    $(".scene-img", el).addEventListener("click", () => chunk.image && openLightbox(chunk.image));
    paintScene(el, chunk);
    return el;
  }

  function paintScene(el, chunk, loading) {
    if (!el) return;
    setImg($("img", el), chunk.image);
    $(".spinner", el).classList.toggle("hidden", !loading);
    $(".placeholder", el).textContent = loading ? "Generando..." : "Pendiente";
    el.classList.toggle("done", !!chunk.image);
    el.classList.toggle("failed", !!chunk.error && !chunk.image);
    const err = $(".s-error", el);
    err.textContent = chunk.error || "";
    err.classList.toggle("hidden", !chunk.error);
  }

  function sceneEl(chunk) {
    return $(`#scenes .scene[data-id="${chunk.id}"]`);
  }

  function buildPrompt(chunk) {
    const chars = (chunk.characters || []).map(charById).filter(Boolean);
    const withRefs = settings.provider !== "pollinations" && chars.some((c) => c.image);
    const scene = chunk.scene || `Ilustra visualmente esta parte de la narración: "${chunk.text}"`;
    let prompt = `${settings.style}.\nEscena: ${scene}\n`;
    if (chars.length) {
      prompt += `Personajes en la escena (mantén EXACTAMENTE la misma cara, pelo, ropa y colores${withRefs ? " que en las imágenes de referencia adjuntas" : ""}):\n`;
      prompt += chars.map((c) => `- ${c.name}: ${c.description || "personaje del guion"}`).join("\n") + "\n";
    }
    prompt += `Formato de imagen ${settings.aspect}. Sin texto, letras, subtítulos ni marcas de agua.`;
    return { prompt, refs: withRefs ? chars.filter((c) => c.image).map((c) => ({ name: c.name, image: c.image })) : [] };
  }

  async function generateScene(chunk) {
    const el = sceneEl(chunk);
    chunk.error = null;
    paintScene(el, chunk, true);
    try {
      const { prompt, refs } = buildPrompt(chunk);
      const seed = settings.seed + (chunk.variant || 0) * 7919;
      chunk.image = await Providers.generateImage(settings, prompt, refs, seed);
    } catch (e) {
      chunk.error = e.message || String(e);
      throw e;
    } finally {
      paintScene(sceneEl(chunk), chunk, false);
      save();
    }
  }

  async function generateAll() {
    if (!state.chunks.length) return toast("Primero divide el guion en escenas.", true);
    const pending = state.chunks.filter((c) => !c.image);
    if (!pending.length) {
      if (!confirm("Todas las escenas tienen imagen. ¿Regenerarlas todas?")) return;
      state.chunks.forEach((c) => {
        c.image = null;
        c.variant = (c.variant || 0) + 1;
      });
      renderScenes();
      return generateAll();
    }

    running = true;
    stopRequested = false;
    $("#btnGenAll").classList.add("hidden");
    $("#btnStop").classList.remove("hidden");
    let failed = 0;
    try {
      if (settings.autoRefs && settings.provider !== "pollinations") await generateMissingRefs(true);

      const queue = pending.slice();
      const worker = async () => {
        while (queue.length && !stopRequested) {
          const chunk = queue.shift();
          try {
            await generateScene(chunk);
          } catch (e) {
            failed++;
            console.warn("Escena fallida", e);
          }
          updateProgress();
        }
      };
      const n = Math.max(1, Math.min(6, settings.concurrency || 1));
      await Promise.all(Array.from({ length: n }, worker));
    } catch (e) {
      toast(e.message || String(e), true);
    } finally {
      running = false;
      $("#btnGenAll").classList.remove("hidden");
      $("#btnStop").classList.add("hidden");
      updateProgress();
    }
    if (stopRequested) toast("Generación detenida.");
    else if (failed) toast(`${failed} escenas fallaron. Pulsa "Generar imágenes" otra vez para reintentarlas.`, true);
    else toast("¡Todas las imágenes están listas!");
  }

  async function makeScenePrompts() {
    if (!state.chunks.length) throw new Error("Primero divide el guion en escenas.");
    const btnText = $("#progressText");
    const scenes = await Providers.scenePrompts(settings, state.chunks, state.characters, (done, total) => {
      btnText.textContent = `Creando prompts de escena: ${done}/${total}`;
    });
    scenes.forEach((s, i) => {
      if (s) state.chunks[i].scene = s;
    });
    save();
    renderScenes();
    toast("Prompts de escena creados. Puedes editarlos antes de generar.");
  }

  function updateProgress() {
    const total = state.chunks.length;
    const done = state.chunks.filter((c) => c.image).length;
    const failed = state.chunks.filter((c) => c.error && !c.image).length;
    $("#progressBar").style.width = total ? `${(done / total) * 100}%` : "0";
    if (!total) {
      $("#progressText").textContent = "Divide el guion para crear las escenas.";
      return;
    }
    $("#progressText").textContent =
      `${done}/${total} imágenes listas` + (failed ? ` · ${failed} con error` : "") + (running ? " · generando..." : "");
  }

  function openLightbox(src) {
    const box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = `<img alt="" />`;
    box.firstChild.src = src;
    box.addEventListener("click", () => box.remove());
    document.body.appendChild(box);
  }

  /* ---------------- Exportar ---------------- */

  async function exportZip() {
    const withImg = state.chunks.filter((c) => c.image);
    if (!withImg.length) throw new Error("Todavía no hay imágenes para descargar.");
    if (typeof JSZip === "undefined") throw new Error("No se pudo cargar JSZip (¿sin conexión?).");
    const zip = new JSZip();
    const times = timings();
    const csv = [["n", "archivo", "inicio", "fin", "texto", "personajes", "escena"]];
    const srt = [];
    state.chunks.forEach((c, i) => {
      const file = `${pad(i + 1)}.png`;
      if (c.image) zip.file(`imagenes/${file}`, c.image.split(",")[1], { base64: true });
      const names = (c.characters || []).map((id) => (charById(id) || {}).name).filter(Boolean).join(" | ");
      csv.push([i + 1, c.image ? file : "", fmtTime(times[i].start, true), fmtTime(times[i].end, true), c.text, names, c.scene || ""]);
      srt.push(`${i + 1}\n${fmtTime(times[i].start, true)} --> ${fmtTime(times[i].end, true)}\n${c.text}\n`);
    });
    const csvText = csv.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    zip.file("escenas.csv", "﻿" + csvText);
    zip.file("subtitulos.srt", srt.join("\n"));
    state.characters.forEach((ch) => {
      if (ch.image) zip.file(`personajes/${ch.name.replace(/[^\p{L}\p{N} _-]/gu, "") || ch.id}.png`, ch.image.split(",")[1], { base64: true });
    });
    const blob = await zip.generateAsync({ type: "blob" });
    download("imagenes-video.zip", blob);
  }

  function exportProject() {
    const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
    download("proyecto-video.json", blob);
  }

  async function importProject(file) {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.chunks)) throw new Error("Archivo de proyecto no válido.");
    state = Object.assign(emptyState(), data);
    save();
    renderAll();
    toast("Proyecto importado.");
  }

  function renderAll() {
    bindScriptValues();
    renderCharacters();
    renderScenes();
  }

  function bindScriptValues() {
    $("#script").value = state.script;
    ["minWords", "maxWords", "wpm"].forEach((k) => ($("#" + k).value = state[k]));
    $("#carry").checked = state.carry;
    updateScriptStats();
  }

  /* ---------------- Inicio ---------------- */

  async function init() {
    const saved = await Storage2.idbGet("project");
    if (saved) state = Object.assign(emptyState(), saved);

    $$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
    bindSettings();
    bindScript();
    renderCharacters();
    renderScenes();

    $("#btnAddChar").addEventListener("click", addCharacter);
    $("#btnAllRefs").addEventListener("click", (e) =>
      withBusy(e.currentTarget, async () => {
        stopRequested = false;
        const n = await generateMissingRefs(false);
        updateProgress();
        toast(n ? `Se crearon ${n} referencias.` : "Todos los personajes con descripción ya tienen referencia.");
      })
    );
    $("#btnGenAll").addEventListener("click", generateAll);
    $("#btnStop").addEventListener("click", () => {
      stopRequested = true;
      $("#progressText").textContent = "Deteniendo cuando terminen las imágenes en curso...";
    });
    $("#btnPrompts").addEventListener("click", (e) => withBusy(e.currentTarget, makeScenePrompts));
    $("#btnZip").addEventListener("click", (e) => withBusy(e.currentTarget, exportZip));
    $("#btnExport").addEventListener("click", exportProject);
    $("#importFile").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) importProject(f).catch((err) => toast(err.message, true));
      e.target.value = "";
    });
    $("#btnReset").addEventListener("click", () => {
      if (!confirm("¿Empezar un proyecto nuevo? Se borrarán el guion, los personajes y las imágenes (los ajustes se mantienen).")) return;
      state = emptyState();
      save();
      renderAll();
      showTab("guion");
    });

    if (!settings.geminiKey && !settings.openaiKey && !settings.pollinationsKey) {
      toast("Configura tu clave de API en ⚙ Ajustes para empezar.");
    }
  }

  init();
})();
