(function () {
  function seedStringToUint32(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i += 1) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffleInPlace(arr, random) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function sampleK(arr, k, random) {
    if (k >= arr.length) {
      return arr.slice();
    }
    if (k <= 0) {
      return [];
    }
    const idx = arr.map((_, i) => i);
    shuffleInPlace(idx, random);
    const picked = idx.slice(0, k).sort((a, b) => a - b);
    return picked.map((i) => arr[i]);
  }

  function isScorableQuestion(q) {
    return q && q.tipo !== "texto-imagem";
  }

  function encadeamentoKindOf(q) {
    if (!q) {
      return "questao";
    }
    return q.tipo === "texto-imagem" ? "texto-imagem" : "questao";
  }

  function canEncadearQuestions(a, b) {
    if (!a || !b) {
      return false;
    }
    return encadeamentoKindOf(a) === encadeamentoKindOf(b);
  }

  function normalizeWeights(questions) {
    const n = questions.length;
    if (n === 0) {
      return { weights: [], warnings: [] };
    }

    const warnings = [];
    const declared = questions.map((q) => (q.peso != null ? q.peso : null));
    const S_decl = declared.reduce((s, p) => (p != null ? s + p : s), 0);
    const U = declared.filter((p) => p == null).length;

    let weights = new Array(n).fill(0);

    if (U === 0) {
      if (S_decl <= 0) {
        throw new Error("Soma de pesos declarados deve ser positiva.");
      }
      if (Math.abs(S_decl - 10) > 1e-6) {
        warnings.push(
          "Pesos declarados somam " + S_decl + "; escalando proporcionalmente para 10.0."
        );
        const factor = 10 / S_decl;
        weights = declared.map((p) => p * factor);
      } else {
        weights = declared.slice();
      }
    } else {
      if (S_decl > 10 + 1e-6) {
        throw new Error(
          "Soma dos pesos declarados (" + S_decl + ") excede 10.0; ajuste o arquivo."
        );
      }
      const remainder = 10 - S_decl;
      if (remainder < -1e-6) {
        throw new Error("Soma dos pesos declarados inconsistente.");
      }
      const each = remainder / U;
      for (let i = 0; i < n; i += 1) {
        weights[i] = declared[i] != null ? declared[i] : each;
      }
    }

    let rounded = weights.map((w) => Math.round(w * 10) / 10);
    const sum = rounded.reduce((a, b) => a + b, 0);
    const drift = Math.round((10 - sum) * 10) / 10;
    if (Math.abs(drift) >= 0.05 && n > 0) {
      rounded[n - 1] = Math.round((rounded[n - 1] + drift) * 10) / 10;
    }

    return { weights: rounded, warnings };
  }

  function normalizeEncadeiaRef(raw) {
    if (raw == null || String(raw).trim() === "") {
      return null;
    }
    const m = /^Q\s*(\d+)$/i.exec(String(raw).trim());
    if (!m) {
      return null;
    }
    return `Q${parseInt(m[1], 10)}`;
  }

  function buildEncadeamentoAdjacency(questions) {
    const byId = new Map();
    for (let qi = 0; qi < questions.length; qi += 1) {
      byId.set(questions[qi].id, questions[qi]);
    }
    const ids = new Set(questions.map((q) => q.id));
    const adj = new Map();
    for (const q of questions) {
      adj.set(q.id, []);
    }
    for (const q of questions) {
      const target = normalizeEncadeiaRef(q.encadeia_com);
      if (!target || target === q.id || !ids.has(target)) {
        continue;
      }
      const targetQ = byId.get(target);
      if (!canEncadearQuestions(q, targetQ)) {
        continue;
      }
      adj.get(q.id).push(target);
      adj.get(target).push(q.id);
    }
    return adj;
  }

  function componentKey(compIds) {
    return compIds
      .slice()
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .join("|");
  }

  class EncadeamentoBatchCycler {
    constructor(allQuestions) {
      this.queues = new Map();
      this.lastPick = new Map();
      const adj = buildEncadeamentoAdjacency(allQuestions);
      const visited = new Set();
      for (const q of allQuestions) {
        if (visited.has(q.id)) {
          continue;
        }
        const stack = [q.id];
        const compIds = [];
        visited.add(q.id);
        while (stack.length) {
          const id = stack.pop();
          compIds.push(id);
          const nbs = adj.get(id) || [];
          for (let ni = 0; ni < nbs.length; ni += 1) {
            const nb = nbs[ni];
            if (!visited.has(nb)) {
              visited.add(nb);
              stack.push(nb);
            }
          }
        }
        if (compIds.length >= 2) {
          const key = componentKey(compIds);
          this.queues.set(key, []);
          this.lastPick.set(key, null);
        }
      }
    }

    _refillQueue(key, compIds, rng) {
      const order = compIds.slice();
      shuffleInPlace(order, rng);
      this.queues.set(key, order);
    }

    pickForComponent(compIds, rng) {
      const key = componentKey(compIds);
      let queue = this.queues.get(key);
      if (!queue) {
        return compIds[Math.floor(rng() * compIds.length)];
      }
      if (queue.length === 0) {
        this._refillQueue(key, compIds, rng);
        queue = this.queues.get(key);
      }
      const picked = queue.shift();
      this.lastPick.set(key, picked);
      return picked;
    }
  }

  function filterPoolAfterEncadeamento(allQuestions, rng, encadeamentoCycler) {
    const adj = buildEncadeamentoAdjacency(allQuestions);
    const excluded = new Set();
    const visited = new Set();
    const encadeamentoEscolhas = {};
    for (const q of allQuestions) {
      if (visited.has(q.id)) {
        continue;
      }
      const stack = [q.id];
      const compIds = [];
      visited.add(q.id);
      while (stack.length) {
        const id = stack.pop();
        compIds.push(id);
        const nbs = adj.get(id) || [];
        for (let ni = 0; ni < nbs.length; ni += 1) {
          const nb = nbs[ni];
          if (!visited.has(nb)) {
            visited.add(nb);
            stack.push(nb);
          }
        }
      }
      if (compIds.length >= 2) {
        const cycler = encadeamentoCycler || null;
        const keep = cycler
          ? cycler.pickForComponent(compIds, rng)
          : compIds[Math.floor(rng() * compIds.length)];
        if (cycler) {
          encadeamentoEscolhas[componentKey(compIds)] = keep;
        }
        for (let ci = 0; ci < compIds.length; ci += 1) {
          const cid = compIds[ci];
          if (cid !== keep) {
            excluded.add(cid);
          }
        }
      }
    }
    return {
      pool: allQuestions.filter((x) => !excluded.has(x.id)),
      encadeamentoEscolhas
    };
  }

  function sortByOrdemFonte(items) {
    return items.slice().sort((a, b) => {
      const oa = a.ordem_fonte != null ? a.ordem_fonte : 0;
      const ob = b.ordem_fonte != null ? b.ordem_fonte : 0;
      return oa - ob;
    });
  }

  function drawExamPlan(allQuestions, rng, options) {
    const opts = options || {};
    const randomizarOrdem = opts.randomizarOrdem !== false;
    const encadeamentoCycler = opts.encadeamentoCycler || null;
    const { pool, encadeamentoEscolhas } = filterPoolAfterEncadeamento(
      allQuestions,
      rng,
      encadeamentoCycler
    );
    const mandatory = pool.filter((q) => !q.eh_opcional);
    const optional = pool.filter((q) => q.eh_opcional);
    const K = Math.ceil(optional.length / 2);
    const selected = sampleK(optional, K, rng);
    const selectedOptionalIds = selected
      .map((q) => q.id)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    let merged = mandatory.concat(selected);
    if (randomizarOrdem) {
      shuffleInPlace(merged, rng);
    } else {
      merged = sortByOrdemFonte(merged);
    }
    const orderIds = merged.map((q) => q.id);
    const scorable = merged.filter(isScorableQuestion);
    const scorableIndices = merged
      .map((q, i) => (isScorableQuestion(q) ? i : -1))
      .filter((i) => i >= 0);
    const r = normalizeWeights(scorable);
    const weightsResolved = merged.map((q, i) => {
      if (!isScorableQuestion(q)) {
        return 0;
      }
      const idx = scorableIndices.indexOf(i);
      return r.weights[idx] != null ? r.weights[idx] : 0;
    });
    return {
      orderIds,
      selectedOptionalIds,
      orderedQuestions: merged,
      weightsResolved,
      warnings: r.warnings,
      encadeamentoEscolhas
    };
  }

  function planFromStoredOrder(allQuestions, orderIds, selectedOptionalIds) {
    const byId = new Map(allQuestions.map((q) => [q.id, q]));
    const orderedQuestions = orderIds.map((id) => byId.get(id)).filter(Boolean);
    const scorable = orderedQuestions.filter(isScorableQuestion);
    const scorableIndices = orderedQuestions
      .map((q, i) => (isScorableQuestion(q) ? i : -1))
      .filter((i) => i >= 0);
    const r = normalizeWeights(scorable);
    const weightsResolved = orderedQuestions.map((q, i) => {
      if (!isScorableQuestion(q)) {
        return 0;
      }
      const idx = scorableIndices.indexOf(i);
      return r.weights[idx] != null ? r.weights[idx] : 0;
    });
    return {
      orderIds,
      selectedOptionalIds: selectedOptionalIds || [],
      orderedQuestions,
      weightsResolved,
      warnings: r.warnings,
      encadeamentoEscolhas: {}
    };
  }

  function bytesToHex(buf) {
    const a = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < a.length; i += 1) {
      s += a[i].toString(16).padStart(2, "0");
    }
    return s;
  }

  async function buildGenerationHashAsync(payloadObj) {
    const sortedOptional = payloadObj.selectedOptionalIds.slice().sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
    const payload = JSON.stringify({
      orderIds: payloadObj.orderIds,
      selectedOptionalIds: sortedOptional
    });
    const enc = new TextEncoder().encode(payload);
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw new Error("SHA-256 indisponivel neste ambiente (crypto.subtle).");
    }
    const digest = await globalThis.crypto.subtle.digest("SHA-256", enc);
    return bytesToHex(digest).slice(0, 12);
  }

  globalThis.examPlanBrowser = {
    seedStringToUint32,
    mulberry32,
    shuffleInPlace,
    sampleK,
    normalizeWeights,
    drawExamPlan,
    planFromStoredOrder,
    EncadeamentoBatchCycler,
    buildGenerationHashAsync
  };
})();
