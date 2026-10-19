/* Divide el guion en fragmentos de 3 a 5 palabras y detecta personajes en cada uno. */
(function () {
  const SENTENCE_RE = /[^.!?…\n]+(?:[.!?…]+["»”')\]]*|\n+|$)/g;
  const CLAUSE_END_RE = /[,;:—)»”"]$/;

  function words(str) {
    return str.trim().split(/\s+/).filter(Boolean);
  }

  // Coste de un fragmento: fuera del rango min-max penaliza mucho; cortar
  // en mitad de una cláusula (sin coma) penaliza un poco.
  function chunkCost(size, min, max, endsAtClause) {
    let cost = 0;
    if (size < min) cost += 10 * (min - size);
    else if (size > max) cost += 10 * (size - max);
    else cost += 0.3 * Math.abs(size - (min + max) / 2);
    if (!endsAtClause) cost += 2;
    return cost;
  }

  // Divide una frase buscando la mejor combinación de cortes (programación dinámica).
  function splitSentence(sentence, min, max) {
    const w = words(sentence);
    const n = w.length;
    if (n <= max) return n ? [w] : [];
    const clauseEnd = (i) => i === n - 1 || CLAUSE_END_RE.test(w[i]);
    const best = new Array(n + 1).fill(Infinity);
    const from = new Array(n + 1).fill(0);
    best[0] = 0;
    for (let j = 1; j <= n; j++) {
      for (let i = Math.max(0, j - max - 2); i < j; i++) {
        const c = best[i] + chunkCost(j - i, min, max, clauseEnd(j - 1));
        if (c < best[j]) {
          best[j] = c;
          from[j] = i;
        }
      }
    }
    const chunks = [];
    for (let j = n; j > 0; j = from[j]) chunks.unshift(w.slice(from[j], j));
    return chunks;
  }

  /**
   * @returns {{text:string, sentence:number, words:number}[]}
   */
  function splitScript(text, min, max) {
    min = Math.max(1, min | 0);
    max = Math.max(min, max | 0);
    const sentences = (text.replace(/\r/g, "").match(SENTENCE_RE) || [])
      .map((s) => s.trim())
      .filter(Boolean);

    const result = [];
    sentences.forEach((sentence, sIdx) => {
      const chunks = splitSentence(sentence, min, max);
      chunks.forEach((c, cIdx) => {
        const prev = result[result.length - 1];
        // Una frase muy corta ("¡No!") se une al fragmento anterior si cabe.
        if (cIdx === 0 && chunks.length === 1 && c.length < min && prev && prev.words + c.length <= max + 1) {
          prev.text += " " + c.join(" ");
          prev.words += c.length;
          return;
        }
        result.push({ text: c.join(" "), sentence: sIdx, words: c.length });
      });
    });
    return result;
  }

  function normalize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  }

  function escapeRe(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function characterMatchers(characters) {
    return characters.map((ch) => {
      const names = [ch.name, ...(ch.aliases || [])]
        .map((n) => normalize(n.trim()))
        .filter(Boolean)
        .map(escapeRe);
      const re = names.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(${names.join("|")})(?=$|[^\\p{L}\\p{N}])`, "u") : null;
      return { id: ch.id, re };
    });
  }

  /**
   * Asigna personajes a cada fragmento. Si un fragmento no nombra a nadie y
   * `carry` está activo, hereda los personajes del fragmento anterior de la
   * misma frase o de la frase inmediatamente anterior (pronombres, "él", "ella"...).
   */
  function assignCharacters(chunks, characters, carry) {
    const matchers = characterMatchers(characters);
    let prevIds = [];
    let prevSentence = -1;
    chunks.forEach((chunk, i) => {
      const text = normalize(chunk.text);
      let found = matchers.filter((m) => m.re && m.re.test(text)).map((m) => m.id);
      const prevChunk = chunks[i - 1];
      // Dentro de la misma frase los personajes se acumulan ("Leo salía a pescar con su abuelo Tomás").
      if (found.length && carry && prevChunk && prevChunk.sentence === chunk.sentence) {
        found = Array.from(new Set([...(prevChunk.characters || []), ...found]));
      }
      if (found.length) {
        chunk.characters = found;
        chunk.inherited = false;
      } else if (carry && prevIds.length && chunk.sentence - prevSentence <= 1) {
        chunk.characters = prevIds.slice();
        chunk.inherited = true;
      } else {
        chunk.characters = [];
        chunk.inherited = false;
      }
      if (found.length) {
        prevIds = found;
        prevSentence = chunk.sentence;
      }
    });
    return chunks;
  }

  window.Splitter = { splitScript, assignCharacters, normalize };
})();
