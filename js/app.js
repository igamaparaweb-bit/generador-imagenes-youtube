/* Lógica principal: guion → escenas de pocas palabras → personajes fijos → un prompt por escena. */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const DEFAULT_SECONDS = 5; // una imagen cada 5 segundos de vídeo

  const STYLE_PRESETS = {
    "Cine realista": "Fotograma cinematográfico realista, iluminación dramática, alto detalle, profundidad de campo, colores ricos",
    "Animación 3D": "Estilo animación 3D tipo Pixar, personajes expresivos, iluminación suave, colores vivos",
    "Anime": "Estilo anime de alta calidad, líneas limpias, colores vibrantes, fondo detallado",
    "Cómic": "Ilustración estilo cómic, tinta marcada, colores planos intensos, sombreado dramático",
    "Acuarela": "Ilustración en acuarela, trazos suaves, papel texturizado, paleta cálida",
    "Documental histórico": "Pintura histórica al óleo, realista, luz de época, atmósfera documental",
    "Boceto a lápiz": "Boceto a lápiz en blanco y negro, trazos sueltos, sombreado a grafito",
    "Terror": "Atmósfera oscura de terror, niebla, iluminación tenue y fría, alto contraste, cinematográfico",
  };

  const DEFAULT_SETTINGS = {
    provider: "gemini",
    geminiKey: "",
    openaiKey: "",
    pollinationsKey: "",
    geminiTextModel: "gemini-3.8-flash",
    openaiTextModel: "gpt-4.1-mini",
    pollinationsTextModel: "openai/gpt-5.4-nano",
    style: STYLE_PRESETS["Cine realista"],
    includeChars: true,
  };

  // Modelos que Google ya retiró: si estaban guardados en este navegador, se usa el nuevo.
  const RETIRED_MODELS = { "gemini-2.5-flash": DEFAULT_SETTINGS.geminiTextModel };

  let settings = Storage2.getSettings(DEFAULT_SETTINGS);
  if (RETIRED_MODELS[settings.geminiTextModel]) settings.geminiTextModel = RETIRED_MODELS[settings.geminiTextModel];
  // Si la IA cambia de modelo sola (porque Google retiró el anterior), se guarda y se muestra en Ajustes.
  Object.defineProperty(settings, "onModelChange", {
    enumerable: false,
    value: (key, model) => {
      settings[key] = model;
      saveSettings();
      const input = document.getElementById(key);
      if (input) input.value = model;
      toast(`Google retiró el modelo anterior; ahora se usa ${model}.`);
    },
  });
  let state = emptyState();

  // Palabras por escena para que cada imagen dure unos `seconds` segundos a la velocidad de la locución.
  function wordsForSeconds(seconds, wpm) {
    const words = (seconds * (wpm || 150)) / 60;
    return { min: Math.max(1, Math.round(words * 0.8)), max: Math.max(1, Math.round(words * 1.2)) };
  }

  function emptyState() {
    const w = wordsForSeconds(DEFAULT_SECONDS, 150);
    return { script: "", secondsPerImage: String(DEFAULT_SECONDS), minWords: w.min, maxWords: w.max, wpm: 150, carry: true, characters: [], chunks: [] };
  }

  const uid = () => Math.random().toString(36).slice(2, 10);
  const pad = (n, len = 3) => String(n).padStart(len, "0");
  const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const noEndDot = (s) => oneLine(s).replace(/[.\s]+$/, "");

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

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(okMsg);
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

  const SETTING_FIELDS = ["provider", "geminiKey", "openaiKey", "pollinationsKey", "geminiTextModel", "openaiTextModel", "pollinationsTextModel", "style"];

  function bindSettings() {
    SETTING_FIELDS.forEach((key) => {
      const el = $("#" + key);
      el.value = settings[key];
      el.addEventListener("change", () => {
        settings[key] = el.value.trim();
        saveSettings();
        if (key === "style") {
          syncStyleInputs();
          renderScenes();
        }
      });
    });
    const inc = $("#includeChars");
    inc.checked = settings.includeChars !== false;
    inc.addEventListener("change", () => {
      settings.includeChars = inc.checked;
      saveSettings();
      renderScenes();
    });

    const presets = $("#stylePresets");
    Object.entries(STYLE_PRESETS).forEach(([name, text]) => {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = name;
      b.addEventListener("click", () => {
        setStyle(text);
        toast(`Estilo: ${name}`);
      });
      presets.appendChild(b);
    });

    // Selector rápido en la pestaña de Prompts (mismo estilo que en Ajustes).
    const quick = $("#styleQuick");
    quick.innerHTML = Object.keys(STYLE_PRESETS).map((n) => `<option value="${n}">${n}</option>`).join("") +
      `<option value="__custom">Personalizado…</option><option value="__none">Sin estilo</option>`;
    quick.addEventListener("change", () => {
      if (quick.value === "__custom") {
        $("#styleQuickText").focus();
        return;
      }
      setStyle(quick.value === "__none" ? "" : STYLE_PRESETS[quick.value]);
    });
    $("#styleQuickText").addEventListener("input", (e) => setStyle(e.target.value, true));
    syncStyleInputs();
  }

  function setStyle(text, fromQuickText) {
    settings.style = text;
    saveSettings();
    syncStyleInputs(fromQuickText);
    renderScenes();
  }

  function syncStyleInputs(fromQuickText) {
    $("#style").value = settings.style;
    const preset = Object.keys(STYLE_PRESETS).find((n) => STYLE_PRESETS[n] === settings.style);
    $("#styleQuick").value = preset || (settings.style ? "__custom" : "__none");
    if (!fromQuickText) $("#styleQuickText").value = preset || !settings.style ? "" : settings.style;
  }

  /* ---------------- Guion ---------------- */

  function bindScriptValues() {
    $("#script").value = state.script;
    $("#secondsPerImage").value = state.secondsPerImage || "custom";
    ["minWords", "maxWords", "wpm"].forEach((k) => ($("#" + k).value = state[k]));
    $("#carry").checked = state.carry;
    updateScriptStats();
  }

  function bindScript() {
    bindScriptValues();
    $("#script").addEventListener("input", (e) => {
      state.script = e.target.value;
      updateScriptStats();
      save();
    });
    $("#secondsPerImage").addEventListener("change", (e) => {
      state.secondsPerImage = e.target.value;
      applySecondsPerImage();
    });
    ["minWords", "maxWords", "wpm"].forEach((k) =>
      $("#" + k).addEventListener("change", (e) => {
        state[k] = Number(e.target.value) || state[k];
        if (k === "wpm") {
          applySecondsPerImage();
          return;
        }
        // Cambiar las palabras a mano pasa a modo "Personalizado".
        state.secondsPerImage = "custom";
        $("#secondsPerImage").value = "custom";
        if (state.maxWords < state.minWords) state.maxWords = state.minWords;
        updateScriptStats();
        save();
        resplitIfNeeded();
      })
    );
    $("#carry").addEventListener("change", (e) => {
      state.carry = e.target.checked;
      save();
      reassignCharacters();
    });

    $("#btnSplit").addEventListener("click", () => splitScript());
    $("#btnDetect").addEventListener("click", (e) => withBusy(e.currentTarget, detectCharacters));
    $("#btnDetect2").addEventListener("click", (e) => withBusy(e.currentTarget, detectCharacters));
  }

  function applySecondsPerImage() {
    if (state.secondsPerImage && state.secondsPerImage !== "custom") {
      const w = wordsForSeconds(Number(state.secondsPerImage), state.wpm);
      state.minWords = w.min;
      state.maxWords = w.max;
      $("#minWords").value = w.min;
      $("#maxWords").value = w.max;
    }
    updateScriptStats();
    save();
    renderScenes();
    resplitIfNeeded();
  }

  // Si ya había escenas, se vuelven a crear con el nuevo tamaño.
  function resplitIfNeeded() {
    if (state.chunks.length && state.script.trim()) splitScript({ stay: true });
  }

  function updateScriptStats() {
    const n = state.script.trim() ? state.script.trim().split(/\s+/).length : 0;
    const avg = (state.minWords + state.maxWords) / 2;
    const mins = n / (state.wpm || 150);
    const secs = (avg * 60) / (state.wpm || 150);
    $("#scriptStats").textContent = `${n} palabras · ~${Math.ceil(n / avg)} imágenes (una cada ~${secs.toFixed(1)} s) · ~${mins.toFixed(1)} min de vídeo`;
  }

  function splitScript(opts = {}) {
    if (!state.script.trim()) return toast("Primero pega el guion.", true);
    if (state.chunks.some((c) => c.scene) && !confirm("Ya hay escenas con descripciones. ¿Volver a dividir el guion? Se perderán.")) return;
    const chunks = Splitter.splitScript(state.script, state.minWords, state.maxWords).map((c) => ({
      id: uid(),
      text: c.text,
      sentence: c.sentence,
      words: c.words,
      scene: "",
    }));
    state.chunks = chunks;
    assignCharacters();
    save();
    renderScenes();
    if (!opts.stay) showTab("escenas");
    toast(`Guion dividido en ${chunks.length} escenas.`);
  }

  // Frase completa a la que pertenece cada fragmento (da contexto al prompt y a la detección de personajes).
  function contexts() {
    const bySentence = {};
    state.chunks.forEach((c) => (bySentence[c.sentence] = bySentence[c.sentence] || []).push(c.text));
    return state.chunks.map((c) => bySentence[c.sentence].join(" "));
  }

  function assignCharacters() {
    const ctx = contexts();
    const probe = state.chunks.map((c, i) => ({ text: ctx[i], sentence: c.sentence }));
    Splitter.assignCharacters(probe, state.characters.filter((c) => c.name), state.carry);
    probe.forEach((p, i) => {
      state.chunks[i].characters = p.characters;
      state.chunks[i].inherited = p.inherited;
    });
  }

  function reassignCharacters() {
    if (!state.chunks.length) return;
    assignCharacters();
    save();
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
      });
      added++;
    });
    save();
    renderCharacters();
    reassignCharacters();
    showTab("personajes");
    toast(added ? `Se encontraron ${added} personajes nuevos. Revisa sus descripciones.` : "No se encontraron personajes nuevos.");
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
    const name = $(".c-name", el);
    const aliases = $(".c-aliases", el);
    const desc = $(".c-desc", el);
    name.value = ch.name;
    aliases.value = (ch.aliases || []).join(", ");
    desc.value = ch.description;

    name.addEventListener("change", () => {
      ch.name = name.value.trim();
      reassignCharacters();
    });
    aliases.addEventListener("change", () => {
      ch.aliases = aliases.value.split(",").map((a) => a.trim()).filter(Boolean);
      reassignCharacters();
    });
    desc.addEventListener("change", () => {
      ch.description = desc.value.trim();
      save();
      renderScenes();
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
    state.characters.push({ id: uid(), name: "Nuevo personaje", aliases: [], description: "" });
    save();
    renderCharacters();
    const cards = $$("#characters .char");
    $(".c-name", cards[cards.length - 1]).select();
  }

  function copyCharacterSheets() {
    const list = state.characters.filter((c) => c.name);
    if (!list.length) return toast("Aún no hay personajes.", true);
    const style = noEndDot(settings.style);
    const text = list
      .map((c) => `${c.name}: ${style ? style + ". " : ""}Hoja de personaje de ${c.name}. ${noEndDot(c.description)}. Cuerpo entero, de frente, fondo liso.`)
      .join("\n\n");
    copyText(text, `Copiadas ${list.length} fichas. Pégalas en Google Flow → Caracteres para crear cada personaje.`);
  }

  /* ---------------- Escenas y prompts ---------------- */

  function buildPrompt(chunk, context) {
    const parts = [];
    const style = noEndDot(settings.style);
    if (style) parts.push(style + ".");
    if (chunk.scene) {
      parts.push(`Escena: ${noEndDot(chunk.scene)}.`);
    } else {
      parts.push(`Ilustra esta parte de la narración: "${noEndDot(chunk.text)}".`);
      if (context && context !== chunk.text) parts.push(`Contexto de la historia: "${noEndDot(context)}".`);
    }
    const chars = (chunk.characters || []).map(charById).filter(Boolean);
    if (chars.length && settings.includeChars !== false) {
      parts.push("Personajes (mantén exactamente este aspecto):");
      parts.push(chars.map((c) => `${c.name}: ${noEndDot(c.description) || "personaje de la historia"}`).join("; ") + ".");
    }
    parts.push("Sin texto, letras ni subtítulos en la imagen.");
    // Una sola línea: así cada prompt ocupa exactamente una línea al copiarlo.
    return oneLine(parts.join(" "));
  }

  function allPrompts() {
    const ctx = contexts();
    return state.chunks.map((c, i) => buildPrompt(c, ctx[i]));
  }

  function renderScenes() {
    const wrap = $("#scenes");
    wrap.innerHTML = "";
    $("#sceneCount").textContent = state.chunks.length;
    const times = timings();
    const ctx = contexts();
    const frag = document.createDocumentFragment();
    state.chunks.forEach((chunk, i) => frag.appendChild(sceneCard(chunk, i, times[i], ctx[i])));
    wrap.appendChild(frag);
    $("#progressText").textContent = state.chunks.length
      ? `${state.chunks.length} escenas · ${state.chunks.filter((c) => c.scene).length} con descripción de escena`
      : "Divide el guion para crear las escenas.";
  }

  function sceneCard(chunk, i, time, context) {
    const el = $("#tplScene").content.firstElementChild.cloneNode(true);
    $(".s-num", el).textContent = `#${i + 1}`;
    $(".s-time", el).textContent = `${fmtTime(time.start)} – ${fmtTime(time.end)}`;
    $(".s-text", el).textContent = `“${chunk.text}”`;
    const promptEl = $(".s-prompt", el);
    const refresh = () => (promptEl.textContent = buildPrompt(chunk, context));

    const sceneInput = $(".s-scene", el);
    sceneInput.value = chunk.scene || "";
    sceneInput.addEventListener("input", () => {
      chunk.scene = sceneInput.value.trim();
      refresh();
      save();
    });

    const chips = $(".s-chars", el);
    state.characters.forEach((ch) => {
      const b = document.createElement("button");
      const on = (chunk.characters || []).includes(ch.id);
      b.className = "chip" + (on ? " on" : "") + (on && chunk.inherited ? " inherited" : "");
      b.textContent = ch.name;
      b.title = "Clic para añadir o quitar este personaje de la escena";
      b.addEventListener("click", () => {
        const set = new Set(chunk.characters || []);
        set.has(ch.id) ? set.delete(ch.id) : set.add(ch.id);
        chunk.characters = Array.from(set);
        chunk.inherited = false;
        b.classList.toggle("on", set.has(ch.id));
        b.classList.remove("inherited");
        refresh();
        save();
      });
      chips.appendChild(b);
    });

    $(".s-copy", el).addEventListener("click", () => copyText(promptEl.textContent, `Prompt #${i + 1} copiado.`));
    refresh();
    return el;
  }

  async function improveScenes() {
    if (!state.chunks.length) throw new Error("Primero divide el guion en escenas.");
    const scenes = await Providers.scenePrompts(settings, state.chunks, state.characters, (done, total) => {
      $("#progressText").textContent = `Escribiendo escenas con IA: ${done}/${total}…`;
    });
    scenes.forEach((s, i) => {
      if (s) state.chunks[i].scene = s;
    });
    save();
    renderScenes();
    toast("Escenas mejoradas. Puedes editarlas antes de copiar.");
  }

  /* ---------------- Exportar ---------------- */

  function requireScenes() {
    if (!state.chunks.length) throw new Error("Primero divide el guion en escenas.");
  }

  function copyAll() {
    requireScenes();
    copyText(allPrompts().join("\n"), `Copiados ${state.chunks.length} prompts (uno por línea). Pégalos en la extensión de Flow, modo "Prompts".`);
  }

  function downloadTxt() {
    requireScenes();
    download("prompts.txt", new Blob([allPrompts().join("\n")], { type: "text/plain;charset=utf-8" }));
  }

  function downloadCsv() {
    requireScenes();
    const times = timings();
    const prompts = allPrompts();
    const rows = [["n", "inicio", "fin", "texto", "personajes", "prompt"]];
    state.chunks.forEach((c, i) => {
      const names = (c.characters || []).map((id) => (charById(id) || {}).name).filter(Boolean).join(" | ");
      rows.push([i + 1, fmtTime(times[i].start, true), fmtTime(times[i].end, true), c.text, names, prompts[i]]);
    });
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    download("escenas.csv", new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  }

  function exportProject() {
    download("proyecto-video.json", new Blob([JSON.stringify(state)], { type: "application/json" }));
  }

  async function importProject(file) {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.chunks)) throw new Error("Archivo de proyecto no válido.");
    state = Object.assign(emptyState(), data);
    state.characters.forEach((c) => delete c.image);
    save();
    renderAll();
    toast("Proyecto importado.");
  }

  function renderAll() {
    bindScriptValues();
    renderCharacters();
    renderScenes();
  }

  /* ---------------- Inicio ---------------- */

  function onClick(id, fn) {
    $(id).addEventListener("click", () => {
      try {
        fn();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }

  async function init() {
    const saved = await Storage2.idbGet("project");
    if (saved) {
      state = Object.assign(emptyState(), saved);
      // Proyectos de la versión anterior: ya no se guardan imágenes.
      state.characters.forEach((c) => delete c.image);
      state.chunks.forEach((c) => {
        delete c.image;
        delete c.error;
      });
      // Proyectos anteriores (3-4 palabras, una imagen cada ~1,5 s): pasan a una imagen cada 5 s.
      if (!saved.secondsPerImage) {
        state.secondsPerImage = String(DEFAULT_SECONDS);
        const w = wordsForSeconds(DEFAULT_SECONDS, state.wpm);
        state.minWords = w.min;
        state.maxWords = w.max;
        if (state.chunks.length && state.script.trim()) {
          state.chunks = Splitter.splitScript(state.script, w.min, w.max).map((c) => ({
            id: uid(), text: c.text, sentence: c.sentence, words: c.words, scene: "",
          }));
          assignCharacters();
        }
        save();
      }
    }

    $$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
    bindSettings();
    bindScript();
    renderCharacters();
    renderScenes();

    $("#btnAddChar").addEventListener("click", addCharacter);
    onClick("#btnCopyChars", copyCharacterSheets);
    $("#btnPrompts").addEventListener("click", (e) => withBusy(e.currentTarget, improveScenes));
    onClick("#btnCopyAll", copyAll);
    onClick("#btnTxt", downloadTxt);
    onClick("#btnCsv", downloadCsv);
    $("#btnExport").addEventListener("click", exportProject);
    $("#importFile").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) importProject(f).catch((err) => toast(err.message, true));
      e.target.value = "";
    });
    $("#btnReset").addEventListener("click", () => {
      if (!confirm("¿Empezar un proyecto nuevo? Se borrarán el guion, los personajes y las escenas (los ajustes se mantienen).")) return;
      state = emptyState();
      save();
      renderAll();
      showTab("guion");
    });
  }

  init();
})();
