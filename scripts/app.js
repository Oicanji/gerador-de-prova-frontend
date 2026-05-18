(function () {
  const TIPOS = new Set(["multipla-escolha", "discursiva", "verdadeiro_falso", "relacionar"]);

  const DEFAULT_MC_OPCOES = 4;
  const DEFAULT_VF_COMBINACOES = 4;
  const FONTES_MAX_BYTES = 20 * 1024 * 1024;
  const FONTE_EXT_OK = /\.(txt|md)$/i;

  function blankOpcoes(n) {
    return Array.from({ length: n }, () => "");
  }

  function padOpcoesMin(arr, min) {
    const o = Array.isArray(arr) ? [...arr] : [];
    if (o.length < min) {
      while (o.length < min) {
        o.push("");
      }
      return o;
    }
    return o;
  }

  function opcaoesParaRender(q) {
    return padOpcoesMin(q.opcoes, DEFAULT_MC_OPCOES);
  }

  function combinacoesParaRender(q) {
    return padOpcoesMin(q.combinacoes, DEFAULT_VF_COMBINACOES);
  }

  function colDirParaRender(q) {
    const left = opcaoesParaRender(q);
    const d = Array.isArray(q.coluna_direita) ? [...q.coluna_direita] : [];
    while (d.length < left.length) {
      d.push("");
    }
    if (d.length > left.length) {
      d.length = left.length;
    }
    return d;
  }

  const META_KEYS = [
    "nome_professor",
    "nome_curso",
    "nome_disciplina",
    "semestre",
    "data_da_prova",
    "tipo_avaliacao",
    "orientacoes"
  ];

  const META_SESSION_KEY = "ifsc-editor-pr-meta-v1";

  const META_HINTS = {
    nome_professor: "Ex.: Nome completo do professor",
    nome_curso: "Ex.: SIGLA e nome completo do curso",
    nome_disciplina: "Ex.: Nome da disciplina",
    semestre: "Ex.: 2026-1",
    data_da_prova: "Ex.: 12/05/2026",
    tipo_avaliacao: "Ex.: Prova teórica",
    orientacoes: "Ex.: Prova individual. Responda com clareza."
  };

  function truncatePlaceholder(s, max) {
    const t = String(s).trim();
    if (t.length <= max) {
      return t;
    }
    return `${t.slice(0, max - 1)}…`;
  }

  function syncMetaSnapshotFromPayload(payload) {
    state.metaSnapshot = {};
    if (!payload || typeof payload !== "object") {
      return;
    }
    for (const key of META_KEYS) {
      if (Object.prototype.hasOwnProperty.call(payload, key) && typeof payload[key] === "string") {
        state.metaSnapshot[key] = payload[key];
      } else {
        state.metaSnapshot[key] = "";
      }
    }
  }

  function applyMetaInputPlaceholders() {
    for (const key of META_KEYS) {
      const el = document.querySelector(`[data-meta-key="${key}"]`);
      if (!el) {
        continue;
      }
      const hint = META_HINTS[key] || "";
      const cur = String(el.value || "").trim();
      const prev = String(state.metaSnapshot[key] || "").trim();
      let ph = hint;
      if (!cur && prev) {
        ph = `${hint} · Último: ${truncatePlaceholder(prev, 48)}`;
      }
      el.placeholder = ph;
    }
  }

  function persistMetaToSession() {
    try {
      const payload = {};
      for (const key of META_KEYS) {
        const el = document.querySelector(`[data-meta-key="${key}"]`);
        payload[key] = el ? String(el.value) : String(state.meta[key] || "");
      }
      sessionStorage.setItem(META_SESSION_KEY, JSON.stringify(payload));
      syncMetaSnapshotFromPayload(payload);
    } catch {
    }
  }

  function hydrateMetaFromSession() {
    try {
      const raw = sessionStorage.getItem(META_SESSION_KEY);
      if (!raw) {
        syncMetaSnapshotFromPayload({});
        return;
      }
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== "object") {
        syncMetaSnapshotFromPayload({});
        return;
      }
      syncMetaSnapshotFromPayload(payload);
      for (const key of META_KEYS) {
        if (Object.prototype.hasOwnProperty.call(payload, key) && typeof payload[key] === "string") {
          state.meta[key] = payload[key];
        }
      }
    } catch {
      syncMetaSnapshotFromPayload({});
    }
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function normalizeMetaValue(s) {
    return String(s).trim().replace(/\s+/g, " ");
  }

  function letterLabel(index) {
    if (index < 0 || index > 25) {
      return String(index + 1);
    }
    return String.fromCharCode(97 + index);
  }

  const ROMAN_ROW_LABELS = [
    "I",
    "II",
    "III",
    "IV",
    "V",
    "VI",
    "VII",
    "VIII",
    "IX",
    "X",
    "XI",
    "XII",
    "XIII",
    "XIV",
    "XV",
    "XVI",
    "XVII",
    "XVIII",
    "XIX",
    "XX"
  ];

  function romanRowLabel(index) {
    if (index < 0 || index >= ROMAN_ROW_LABELS.length) {
      return String(index + 1);
    }
    return ROMAN_ROW_LABELS[index];
  }

  function normalizeMcRespostaLetter(raw, optionCount) {
    const s = String(raw || "").trim().toLowerCase();
    if (!s || /[;,]/.test(s) || s.length > 2) {
      return "";
    }
    const c = s.charAt(0);
    if (c < "a" || c > "z") {
      return "";
    }
    const idx = c.charCodeAt(0) - 97;
    if (idx >= optionCount) {
      return "";
    }
    return c;
  }

  function normalizeTipo(raw) {
    if (!raw) return null;
    const t = String(raw)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_");
    if (t === "multipla_escolha" || t === "multipla-escolha") return "multipla-escolha";
    if (t === "discursiva") return "discursiva";
    if (
      t === "verdadeiro_falso" ||
      t === "verdadeiro-e-falso" ||
      t === "verdadeiro_e_falso" ||
      t === "vf"
    ) {
      return "verdadeiro_falso";
    }
    if (
      t === "relacionar" ||
      t === "correlacionar" ||
      t === "associar" ||
      t === "correlacao" ||
      t === "parear"
    ) {
      return "relacionar";
    }
    return null;
  }

  function parsePeso(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === "") return null;
    const n = Number.parseFloat(String(raw).trim().replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      throw new Error("invalid");
    }
    return n;
  }

  function createEmptyQuestion() {
    const stableKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `sk-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    return {
      stableKey,
      pergunta: "",
      tipo: "multipla-escolha",
      opcoes: blankOpcoes(DEFAULT_MC_OPCOES),
      coluna_direita: blankOpcoes(DEFAULT_MC_OPCOES),
      combinacoes: blankOpcoes(DEFAULT_VF_COMBINACOES),
      linhas: 3,
      resposta: "",
      eh_opcional: false,
      apenas_renderizar_sozinha: false,
      encadeia_com_stable_key: null,
      peso: null,
      foto_enunciado_basename_md: null,
      foto_enunciado_bytes: null,
      foto_enunciado_ext: null
    };
  }

  function normalizeSimNaoImport(raw, defaultValue, fieldName = "eh_opcional") {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return defaultValue;
    }
    const s = String(raw)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (s === "sim" || s === "s" || s === "yes" || s === "true" || s === "1") {
      return true;
    }
    if (s === "nao" || s === "n" || s === "no" || s === "false" || s === "0") {
      return false;
    }
    throw new Error(`${fieldName} inválido: "${raw}" (use sim ou nao).`);
  }

  function splitOpcoesImport(line) {
    return line
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function normalizeImportBlock(block) {
    return block
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
  }

  function isMetaBlockImport(block) {
    return /^#\s*meta\b/i.test(block.trim());
  }

  function parseMetaBlockImport(block) {
    const lines = block.split(/\r?\n/).slice(1);
    const meta = {};
    for (const line of lines) {
      const m = line.match(/^([\w_]+)\s*:\s*(.*)$/);
      if (m) {
        meta[m[1].toLowerCase()] = m[2].trim();
      }
    }
    return meta;
  }

  function isPrBlockImport(block) {
    return /^\s*pergunta\s*:/im.test(block);
  }

  function parsePrFieldsImport(block) {
    const lines = block.split(/\r?\n/);
    const fields = {};
    let currentKey = null;
    for (const line of lines) {
      const keyMatch = line.match(/^([\w_]+)\s*:\s*(.*)$/);
      if (keyMatch) {
        currentKey = keyMatch[1].toLowerCase();
        fields[currentKey] = keyMatch[2];
      } else if (currentKey) {
        fields[currentKey] = `${fields[currentKey]}\n${line}`;
      }
    }
    for (const k of Object.keys(fields)) {
      fields[k] = fields[k].trim();
    }
    return fields;
  }

  function parsePesoImport(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return null;
    }
    const n = Number.parseFloat(String(raw).trim().replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      throw new Error(`peso inválido: "${raw}" (esperado 0,0 a 10,0).`);
    }
    return n;
  }

  function parsePrBlockToQuestionImport(block, index) {
    const id = `Q${index + 1}`;
    const f = parsePrFieldsImport(block);
    if (!f.pergunta) {
      throw new Error(`${id}: campo pergunta é obrigatório.`);
    }
    const tipo = normalizeTipo(f.tipo);
    if (!tipo || !TIPOS.has(tipo)) {
      throw new Error(
        `${id}: tipo inválido "${f.tipo}". Use multipla-escolha, discursiva, verdadeiro_falso ou relacionar.`
      );
    }
    let opcoes = null;
    if (f.opcoes !== undefined && f.opcoes !== "") {
      opcoes = splitOpcoesImport(f.opcoes);
    }
    const rawColDir = f.coluna_direita ?? f.direita ?? "";
    let coluna_direita = null;
    if (String(rawColDir).trim() !== "") {
      coluna_direita = splitOpcoesImport(String(rawColDir));
    }
    let combinacoes = null;
    if (f.combinacoes !== undefined && f.combinacoes !== "") {
      combinacoes = splitOpcoesImport(f.combinacoes);
    }
    let linhas = null;
    if (f.linhas !== undefined && String(f.linhas).trim() !== "") {
      linhas = Number.parseInt(String(f.linhas).trim(), 10);
      if (!Number.isInteger(linhas) || linhas < 1) {
        throw new Error(`${id}: linhas deve ser inteiro ≥ 1.`);
      }
    }
    const resposta =
      f.resposta !== undefined && String(f.resposta).trim() !== ""
        ? f.resposta.trim()
        : null;
    const eh_opcional = normalizeSimNaoImport(f.eh_opcional, false, "eh_opcional");
    const apenas_renderizar_sozinha = normalizeSimNaoImport(
      f.apenas_renderizar_sozinha,
      false,
      "apenas_renderizar_sozinha"
    );
    const peso = parsePesoImport(f.peso);
    if (tipo !== "relacionar" && coluna_direita != null && coluna_direita.length > 0) {
      throw new Error(`${id}: coluna_direita só é permitido para tipo relacionar.`);
    }
    if (tipo === "discursiva") {
      if (!linhas) {
        throw new Error(`${id}: discursiva exige campo linhas.`);
      }
      if (opcoes && opcoes.length > 0) {
        throw new Error(`${id}: discursiva não deve ter opcoes.`);
      }
      if (combinacoes && combinacoes.length > 0) {
        throw new Error(`${id}: discursiva não deve ter combinacoes.`);
      }
    } else if (tipo === "verdadeiro_falso") {
      if (!opcoes || opcoes.length < 2) {
        throw new Error(`${id}: verdadeiro_falso exige afirmações em opcoes (mínimo 2, separadas por ;).`);
      }
      if (!combinacoes || combinacoes.length < 2) {
        throw new Error(
          `${id}: verdadeiro_falso exige campo combinacoes com pelo menos duas alternativas (separadas por ;).`
        );
      }
      if (linhas) {
        throw new Error(`${id}: linhas só é permitido para discursiva.`);
      }
    } else if (tipo === "relacionar") {
      if (!opcoes || opcoes.length < 2) {
        throw new Error(
          `${id}: relacionar exige coluna esquerda em opcoes (mínimo 2 itens, separados por ;).`
        );
      }
      if (!coluna_direita || coluna_direita.length !== opcoes.length) {
        throw new Error(
          `${id}: relacionar exige coluna_direita (ou direita) com o mesmo número de itens que opcoes (${opcoes ? opcoes.length : 0} em cada coluna).`
        );
      }
      if (!combinacoes || combinacoes.length < 2) {
        throw new Error(
          `${id}: relacionar exige campo combinacoes com pelo menos duas alternativas (separadas por ;).`
        );
      }
      if (linhas) {
        throw new Error(`${id}: linhas só é permitido para discursiva.`);
      }
    } else {
      if (!opcoes || opcoes.length < 2) {
        throw new Error(`${id}: ${tipo} exige pelo menos duas opções (separadas por ;).`);
      }
      if (combinacoes && combinacoes.length > 0) {
        throw new Error(`${id}: multipla-escolha não deve ter combinacoes.`);
      }
      if (linhas) {
        throw new Error(`${id}: linhas só é permitido para discursiva.`);
      }
    }
    let foto_enunciado = null;
    if (f.foto_enunciado != null && String(f.foto_enunciado).trim() !== "") {
      const raw = String(f.foto_enunciado).trim();
      let s = raw.replace(/\\/g, "/");
      const parts = s.split("/").filter(Boolean);
      s = parts[parts.length - 1] || "";
      if (!/^[a-zA-Z0-9._-]+\.(png|jpe?g|gif|webp)$/i.test(s)) {
        throw new Error(`${id}: foto_enunciado inválido "${raw}".`);
      }
      foto_enunciado = s;
    }
    let encadeia_com = null;
    if (f.encadeia_com != null && String(f.encadeia_com).trim() !== "") {
      const rawE = String(f.encadeia_com).trim();
      const me = /^Q\s*(\d+)$/i.exec(rawE);
      if (!me) {
        throw new Error(`${id}: encadeia_com inválido "${rawE}" (use Q1, Q2, …).`);
      }
      encadeia_com = `Q${parseInt(me[1], 10)}`;
      if (encadeia_com === id) {
        throw new Error(`${id}: encadeia_com não pode apontar para a própria questão.`);
      }
    }
    return {
      id,
      pergunta: f.pergunta,
      tipo,
      opcoes,
      coluna_direita: tipo === "relacionar" ? coluna_direita : null,
      combinacoes,
      linhas,
      resposta,
      eh_opcional,
      apenas_renderizar_sozinha,
      peso,
      foto_enunciado,
      encadeia_com
    };
  }

  function isQuestionBlockImport(block) {
    if (!block) {
      return false;
    }
    if (isMetaBlockImport(block)) {
      return false;
    }
    const lowerBlock = block.toLowerCase();
    if (lowerBlock.startsWith("# lista de topicos")) {
      return false;
    }
    if (lowerBlock.startsWith("# questoes")) {
      return false;
    }
    const lines = block.split("\n").map((line) => line.trim());
    if (lines.length === 0) {
      return false;
    }
    if (/^\d+\./.test(lines[0]) && lines.length === 1) {
      return false;
    }
    return true;
  }

  function parseMarkdownPrImport(content) {
    const blocks = content
      .split(/\r?\n\s*\r?\n/g)
      .map(normalizeImportBlock)
      .filter(Boolean);
    let meta = null;
    let startIdx = 0;
    if (blocks[0] && isMetaBlockImport(blocks[0])) {
      meta = parseMetaBlockImport(blocks[0]);
      startIdx = 1;
    }
    const questionBlocks = blocks.slice(startIdx).filter(isQuestionBlockImport);
    if (questionBlocks.length === 0) {
      throw new Error(
        "Nenhuma questão encontrada. Separe cada bloco com uma linha em branco e inicie com pergunta:"
      );
    }
    const parsed = [];
    for (let i = 0; i < questionBlocks.length; i += 1) {
      const text = questionBlocks[i];
      if (!isPrBlockImport(text)) {
        throw new Error(
          `Bloco ${i + 1} não está no formato PR (esperado linha começando com "pergunta:").`
        );
      }
      parsed.push(parsePrBlockToQuestionImport(text, i));
    }
    for (let ei = 0; ei < parsed.length; ei += 1) {
      const p = parsed[ei];
      if (!p.encadeia_com) {
        continue;
      }
      const mj = /^Q\s*(\d+)$/i.exec(String(p.encadeia_com).trim());
      if (!mj) {
        throw new Error(`Q${ei + 1}: encadeia_com inválido.`);
      }
      const jj = parseInt(mj[1], 10) - 1;
      if (jj < 0 || jj >= parsed.length) {
        throw new Error(`Q${ei + 1}: encadeia_com fora da lista (${p.encadeia_com}).`);
      }
      if (jj === ei) {
        throw new Error(`Q${ei + 1}: encadeia_com inválido.`);
      }
    }
    return { meta, questions: parsed };
  }

  function questionFromPrParsed(p, index) {
    const tipo = p.tipo;
    const id = p.id != null && String(p.id).trim() !== "" ? String(p.id).trim() : `Q${index + 1}`;
    let opcoes;
    let coluna_direita;
    let combinacoes;
    let linhasVal;
    if (tipo === "discursiva") {
      opcoes = blankOpcoes(DEFAULT_MC_OPCOES);
      coluna_direita = blankOpcoes(DEFAULT_MC_OPCOES);
      combinacoes = blankOpcoes(DEFAULT_VF_COMBINACOES);
      linhasVal = p.linhas;
    } else if (tipo === "verdadeiro_falso") {
      opcoes = padOpcoesMin(p.opcoes || [], DEFAULT_MC_OPCOES);
      coluna_direita = blankOpcoes(DEFAULT_MC_OPCOES);
      combinacoes = padOpcoesMin(p.combinacoes || [], DEFAULT_VF_COMBINACOES);
      linhasVal = null;
    } else if (tipo === "relacionar") {
      opcoes = padOpcoesMin(p.opcoes || [], DEFAULT_MC_OPCOES);
      const n = opcoes.length;
      const rawCd = Array.isArray(p.coluna_direita) ? p.coluna_direita : [];
      coluna_direita = padOpcoesMin(rawCd, n).slice(0, n);
      combinacoes = padOpcoesMin(p.combinacoes || [], DEFAULT_VF_COMBINACOES);
      linhasVal = null;
    } else {
      opcoes = padOpcoesMin(p.opcoes || [], DEFAULT_MC_OPCOES);
      coluna_direita = blankOpcoes(DEFAULT_MC_OPCOES);
      combinacoes = blankOpcoes(DEFAULT_VF_COMBINACOES);
      linhasVal = null;
    }
    let resposta = p.resposta != null ? String(p.resposta).trim() : "";
    if (tipo === "multipla-escolha") {
      const n = opcoes.length;
      resposta = normalizeMcRespostaLetter(resposta, n);
    } else if (tipo === "verdadeiro_falso" || tipo === "relacionar") {
      const n = combinacoes.length;
      resposta = normalizeMcRespostaLetter(resposta, n);
    } else {
      resposta = "";
    }
    return {
      id,
      stableKey:
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `sk-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      pergunta: p.pergunta || "",
      tipo,
      opcoes,
      coluna_direita,
      combinacoes,
      linhas: tipo === "discursiva" ? linhasVal : null,
      resposta,
      eh_opcional: !!p.eh_opcional,
      apenas_renderizar_sozinha: !!p.apenas_renderizar_sozinha,
      encadeia_com_stable_key: null,
      peso: p.peso != null && Number.isFinite(p.peso) ? p.peso : null,
      foto_enunciado_basename_md:
        p.foto_enunciado != null && String(p.foto_enunciado).trim() !== ""
          ? String(p.foto_enunciado).trim()
          : null,
      foto_enunciado_bytes: null,
      foto_enunciado_ext: null
    };
  }

  function resolveEncadeiaStableKeysFromImport(questions, parsedRows) {
    for (let i = 0; i < questions.length; i += 1) {
      const p = parsedRows[i];
      if (!p || !p.encadeia_com) {
        continue;
      }
      const m = /^Q\s*(\d+)$/i.exec(String(p.encadeia_com).trim());
      if (!m) {
        continue;
      }
      const j = parseInt(m[1], 10) - 1;
      if (j >= 0 && j < questions.length && j !== i) {
        questions[i].encadeia_com_stable_key = questions[j].stableKey;
      }
    }
  }

  function applyEncadeamentoOpcionalRules(questions) {
    const targeted = new Set();
    for (const q of questions) {
      if (q.encadeia_com_stable_key) {
        targeted.add(q.encadeia_com_stable_key);
      }
    }
    for (const q of questions) {
      if (q.encadeia_com_stable_key || targeted.has(q.stableKey)) {
        q.eh_opcional = false;
      }
    }
  }

  function listEncadeadaPorIds(questions, myIndex) {
    const sk = questions[myIndex].stableKey;
    const ids = [];
    questions.forEach((oq, j) => {
      if (oq.encadeia_com_stable_key === sk) {
        ids.push(`Q${j + 1}`);
      }
    });
    return ids;
  }

  function questionEncadeioLocked(questions, idx) {
    const sk = questions[idx].stableKey;
    if (questions[idx].encadeia_com_stable_key) {
      return true;
    }
    return questions.some((oq) => oq.encadeia_com_stable_key === sk);
  }

  function buildQuestionsForExamPlanEngine(questions) {
    return questions.map((tq, idx) => {
      let encadeia_com = null;
      if (tq.encadeia_com_stable_key) {
        const j = questions.findIndex((x) => x.stableKey === tq.encadeia_com_stable_key);
        if (j >= 0) {
          encadeia_com = `Q${j + 1}`;
        }
      }
      return {
        ...tq,
        id: `Q${idx + 1}`,
        encadeia_com
      };
    });
  }

  function clearEncadeiaReferringTo(questions, removedStableKey) {
    for (const q of questions) {
      if (q.encadeia_com_stable_key === removedStableKey) {
        q.encadeia_com_stable_key = null;
      }
    }
  }

  const state = {
    includeMeta: true,
    meta: Object.fromEntries(META_KEYS.map((k) => [k, ""])),
    metaSnapshot: {},
    questions: [createEmptyQuestion()],
    filename: "fonte.pr",
    correcaoEmbedded: null,
    fontes: [],
    prLoaded: false,
    prDisplayName: "",
    generatedPdfBlob: null,
    generatedPdfObjectUrl: null
  };

  let correcaoPorRefByNorm = null;
  let fotoModalQuestionIndex = null;
  let fotoModalInstance = null;
  let gerarQuestaoModalInstance = null;
  let gerarProvaModalInstance = null;
  let gerarQuestaoInFlight = false;
  let gerarProvaInFlight = false;
  let gerarProvasInFlight = false;
  let aiOnline = false;
  let apiOnline = false;
  let apiOfflineModalInstance = null;
  let gerarProvasModalInstance = null;
  let aiLocalModalInstance = null;
  const modalAnexosPendentes = {
    gerarQuestao: [],
    gerarProva: []
  };

  function opcaoKeyToIndex(key) {
    const m = String(key || "").match(/^opcao(\d+)$/i);
    if (!m) return -1;
    return parseInt(m[1], 10) - 1;
  }

  function opcaoKeyToLetter(key, optionCount) {
    const idx = opcaoKeyToIndex(key);
    if (idx < 0 || idx >= optionCount) return "";
    return letterLabel(idx);
  }

  function normalizeStringArray(arr, minLen) {
    const out = Array.isArray(arr) ? arr.map((s) => String(s || "").trim()) : [];
    while (out.length < minLen) out.push("");
    return out;
  }

  function parseVfSequenceTokens(raw) {
    return String(raw || "")
      .toUpperCase()
      .replace(/\be\b/g, ",")
      .split(/[,;\s]+/)
      .map((t) => t.trim())
      .filter((t) => t === "V" || t === "F");
  }

  function formatVfCombinacao(tokens) {
    const t = tokens.filter((x) => x === "V" || x === "F");
    if (t.length === 0) return "";
    if (t.length === 1) return t[0];
    if (t.length === 2) return `${t[0]}, ${t[1]}`;
    return `${t.slice(0, -1).join(", ")} e ${t[t.length - 1]}`;
  }

  function vfSequencesMatch(a, b) {
    const ta = parseVfSequenceTokens(a);
    const tb = parseVfSequenceTokens(b);
    if (ta.length === 0 || tb.length === 0) return false;
    if (ta.length !== tb.length) return false;
    return ta.every((v, i) => v === tb[i]);
  }

  function normalizeVfCombinacaoDisplay(raw) {
    const tokens = parseVfSequenceTokens(raw);
    return formatVfCombinacao(tokens);
  }

  function aiMelhorarCampoBtn(i, target, optIndex, extraClass) {
    const hidden = aiOnline ? "" : " d-none";
    const optAttr = optIndex != null && optIndex !== "" ? ` data-opt="${optIndex}"` : "";
    const cls = extraClass ? ` ${extraClass}` : "";
    return `<button type="button" class="btn btn-outline-secondary btn-sm btn-ai-campo${hidden}${cls}" data-action="ai-melhorar-campo" data-q="${i}" data-ai-target="${escapeAttr(target)}"${optAttr} title="Melhorar texto com IA">Melhorar</button>`;
  }

  function aiTargetToPapel(target, tipo) {
    if (target === "pergunta") return "enunciado";
    if (target === "col_dir") return "coluna_direita";
    if (target === "opcao") {
      return normalizeTipo(tipo) === "verdadeiro_falso" ? "afirmacao" : "coluna_esquerda";
    }
    return "enunciado";
  }

  function applyMelhorarCampoToState(q, target, optIndex, texto) {
    const t = String(texto || "").trim();
    if (!t) return;
    if (target === "pergunta") {
      q.pergunta = t;
      return;
    }
    const j = parseInt(optIndex, 10);
    if (Number.isNaN(j)) return;
    if (target === "opcao") {
      if (!Array.isArray(q.opcoes)) q.opcoes = blankOpcoes(DEFAULT_MC_OPCOES);
      q.opcoes[j] = t;
    } else if (target === "col_dir") {
      if (!Array.isArray(q.coluna_direita)) q.coluna_direita = blankOpcoes(DEFAULT_MC_OPCOES);
      q.coluna_direita[j] = t;
    }
  }

  function revokeGeneratedPdfUrl() {
    if (state.generatedPdfObjectUrl) {
      URL.revokeObjectURL(state.generatedPdfObjectUrl);
      state.generatedPdfObjectUrl = null;
    }
  }

  function setGeneratedPdf(blob) {
    revokeGeneratedPdfUrl();
    state.generatedPdfBlob = blob || null;
    const btnVer = document.getElementById("btnVerPdf");
    if (blob) {
      state.generatedPdfObjectUrl = URL.createObjectURL(blob);
      if (btnVer) {
        btnVer.classList.remove("d-none");
      }
    } else if (btnVer) {
      btnVer.classList.add("d-none");
    }
  }

  function setApiUiOnline(online, detail) {
    apiOnline = !!online;
    const btn = document.getElementById("apiStatusBtn");
    if (btn) {
      btn.classList.remove("api-status-loading");
      btn.classList.toggle("api-status-online", apiOnline);
      btn.classList.toggle("api-status-offline", !apiOnline);
      btn.title = apiOnline
        ? "Servidor de geração online"
        : "Servidor indisponível — clique para ver causas (bloqueador, CORS ou cold start).";
    }
    const hintEl = document.getElementById("modalApiOfflineHint");
    if (hintEl && detail && detail.hint && !apiOnline) {
      hintEl.textContent = detail.hint;
    } else if (hintEl && apiOnline) {
      hintEl.textContent = "";
    }
    updateGerarProvasButton();
  }

  function updateGerarProvasButton() {
    const btn = document.getElementById("btnGerarProvas");
    const spinner = document.getElementById("btnGerarProvasSpinnerOffline");
    if (!btn) {
      return;
    }
    if (gerarProvasInFlight) {
      btn.classList.remove("btn-secondary", "btn-success", "btn-gerar-offline");
      if (spinner) {
        spinner.classList.add("d-none");
      }
      setButtonLoading(btn, true, { idleText: "Gerar", loadingText: "Gerando…" });
      return;
    }
    setButtonLoading(btn, false, { idleText: "Gerar" });
    btn.classList.remove("btn-gerar-offline");
    if (!apiOnline) {
      btn.classList.remove("btn-success");
      btn.classList.add("btn-secondary", "btn-gerar-offline");
      btn.disabled = true;
      if (spinner) {
        spinner.classList.remove("d-none");
      }
    } else {
      btn.classList.remove("btn-secondary");
      btn.classList.add("btn-success");
      btn.disabled = false;
      if (spinner) {
        spinner.classList.add("d-none");
      }
    }
  }

  function openApiOfflineModal() {
    const el = document.getElementById("modalApiOffline");
    if (!el || typeof bootstrap === "undefined") {
      return;
    }
    if (!apiOfflineModalInstance) {
      apiOfflineModalInstance = new bootstrap.Modal(el);
    }
    apiOfflineModalInstance.show();
  }

  function openGerarProvasModal() {
    if (!apiOnline || gerarProvasInFlight) {
      return;
    }
    const el = document.getElementById("modalGerarProvas");
    if (!el || typeof bootstrap === "undefined") {
      return;
    }
    if (!gerarProvasModalInstance) {
      gerarProvasModalInstance = new bootstrap.Modal(el);
    }
    gerarProvasModalInstance.show();
  }

  async function buildPrZip() {
    readMetaFromDom();
    readQuestionsFromDom();
    const zip = new JSZip();
    zip.file("principal.md", serializeMd());
    zip.folder("fotos").file(".gitkeep", "");
    state.questions.forEach((q, qi) => {
      const base = exportFotoBasenameForZip(q, qi);
      if (base && q.foto_enunciado_bytes && q.foto_enunciado_bytes.byteLength) {
        zip.file(`fotos/${base}`, q.foto_enunciado_bytes, { binary: true });
      }
    });
    exportFontesToZip(zip);
    if (state.correcaoEmbedded && typeof state.correcaoEmbedded === "object" && state.correcaoEmbedded.byRef) {
      zip.file(
        "correcao-por-ref.json",
        JSON.stringify(
          {
            version: state.correcaoEmbedded.version || 1,
            sourcePath: state.correcaoEmbedded.sourcePath,
            generatedAt: state.correcaoEmbedded.generatedAt,
            byRef: state.correcaoEmbedded.byRef,
            ...(state.correcaoEmbedded.lastRun && typeof state.correcaoEmbedded.lastRun === "object"
              ? { lastRun: state.correcaoEmbedded.lastRun }
              : {})
          },
          null,
          2
        )
      );
    }
    if (state.generatedPdfBlob) {
      zip.file("gerado/todas-provas.pdf", state.generatedPdfBlob);
    }
    return zip;
  }

  async function buildPrBlob() {
    const zip = await buildPrZip();
    return zip.generateAsync({ type: "blob" });
  }

  async function importPrFromArrayBuffer(arrayBuffer, fileName, fillMeta) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip não carregou. Recarregue a página.");
    }
    const zip = await JSZip.loadAsync(arrayBuffer);
    const keys = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
    const key = keys.find((k) => {
      const base = k.split("/").pop();
      return base && base.toLowerCase() === "principal.md";
    });
    if (!key) {
      throw new Error("Arquivo .pr inválido: falta principal.md no pacote.");
    }
    let raw = await zip.file(key).async("string");
    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
    }
    const corrKey = keys.find((k) => {
      const base = k.split("/").pop();
      return base && base.toLowerCase() === "correcao-por-ref.json";
    });
    let correcaoPayload = null;
    if (corrKey) {
      try {
        correcaoPayload = JSON.parse(await zip.file(corrKey).async("string"));
      } catch {
        correcaoPayload = null;
      }
    }
    const useFillMeta =
      fillMeta !== undefined ? fillMeta : document.getElementById("importFillMeta")?.checked;
    applyImportedMarkdown(raw, fileName, useFillMeta, correcaoPayload);
    await hydrateFotosFromZip(zip, state.questions);
    await hydrateFontesFromZip(zip);
    const pdfKey = keys.find((k) => {
      const norm = k.replace(/\\/g, "/").toLowerCase();
      return norm.endsWith("todas-provas.pdf") || norm.endsWith("gerado/todas-provas.pdf");
    });
    if (pdfKey) {
      const pdfBlob = await zip.file(pdfKey).async("blob");
      setGeneratedPdf(pdfBlob);
    }
    await runCorrigirTodosGabaritos({ silentNoData: true });
    updateCorrigirTabBadge(correcaoPorRefByNorm ? Object.keys(correcaoPorRefByNorm).length : 0);
    showPrImportPanels(true, formatPrDisplayName(fileName));
  }

  async function runGerarProvasConfirm() {
    const errors = validateAll();
    showValidationErrors(errors);
    if (errors.length) {
      return;
    }
    const api = globalThis.editorBackendApi;
    if (!api || !apiOnline) {
      return;
    }
    const quantidadeEl = document.getElementById("gerarProvasQuantidade");
    let quantidade = quantidadeEl ? parseInt(quantidadeEl.value, 10) : 1;
    if (Number.isNaN(quantidade) || quantidade < 1) {
      quantidade = 1;
    }
    if (quantidade > 30) {
      quantidade = 30;
    }
    hideGerarProvasModal();
    gerarProvasInFlight = true;
    updateGerarProvasButton();
    try {
      const prBlob = await buildPrBlob();
      const filename = ensurePrFilename(
        document.getElementById("outFilename").value || state.filename
      );
      const result = await api.startGeneration({
        prBlob,
        filename,
        quantidade,
        onProgress(status) {
          const btn = document.getElementById("btnGerarProvas");
          if (!btn || !status || !status.progress) {
            return;
          }
          const p = status.progress;
          if (p.phase === "compile") {
            btn.title = `Compilando prova ${p.current} de ${p.total}`;
          } else if (p.phase === "merge") {
            btn.title = "Mesclando PDFs";
          }
        }
      });
      await importPrFromArrayBuffer(result.prUpdatedBuffer, "prova-atualizada.pr", true);
      setGeneratedPdf(result.pdfBlob);
      showValidationErrors([]);
    } catch (err) {
      showValidationErrors([String(err && err.message ? err.message : err)], {
        title: "Erro ao gerar provas:",
        scroll: true,
      });
    } finally {
      gerarProvasInFlight = false;
      const btn = document.getElementById("btnGerarProvas");
      if (btn) {
        btn.title = "";
      }
      updateGerarProvasButton();
    }
  }

  function hideGerarProvasModal() {
    const confirmBtn = document.getElementById("gerarProvasConfirm");
    if (confirmBtn && typeof confirmBtn.blur === "function") {
      confirmBtn.blur();
    }
    if (gerarProvasModalInstance) {
      gerarProvasModalInstance.hide();
    }
  }

  function openAiLocalModal() {
    const el = document.getElementById("modalAiLocal");
    if (!el || typeof bootstrap === "undefined") {
      return;
    }
    if (!aiLocalModalInstance) {
      aiLocalModalInstance = new bootstrap.Modal(el);
    }
    aiLocalModalInstance.show();
  }

  function setAiUiVisible(online) {
    aiOnline = !!online;
    const btn = document.getElementById("aiStatusBtn");
    if (btn) {
      btn.classList.remove("ai-status-loading");
      btn.classList.toggle("ai-status-online", aiOnline);
      btn.classList.toggle("ai-status-offline", !aiOnline);
      btn.title = aiOnline
        ? "Assistente IA (chat-gpb) disponível localmente"
        : "IA só funciona com o chat-gpb no seu computador. Clique para mais informações.";
    }
    document.querySelectorAll(".btn-ai-campo").forEach((el) => {
      el.classList.toggle("d-none", !aiOnline);
    });
    document.querySelectorAll('[data-action="ai-gerar-opcoes"]').forEach((el) => {
      el.classList.toggle("d-none", !aiOnline);
    });
    const btnGerarQuestao = document.getElementById("btnGerarQuestao");
    if (btnGerarQuestao) {
      btnGerarQuestao.classList.toggle("d-none", !aiOnline);
      if (!gerarQuestaoInFlight) {
        btnGerarQuestao.disabled = !aiOnline;
      }
    }
    const gerarConfirm = document.getElementById("gerarQuestaoConfirm");
    if (gerarConfirm && !gerarQuestaoInFlight) {
      gerarConfirm.disabled = !aiOnline;
    }
    const gerarProvaConfirm = document.getElementById("gerarProvaConfirm");
    if (gerarProvaConfirm && !gerarProvaInFlight) {
      gerarProvaConfirm.disabled = !aiOnline;
    }
    render();
  }

  function clearQuestionAiAlert(card) {
    if (!card) return;
    card.querySelectorAll(".question-ai-alert").forEach((el) => el.remove());
  }

  function showQuestionAiAlert(card, message, isError) {
    clearQuestionAiAlert(card);
    if (!card || !message) return;
    const div = document.createElement("div");
    div.className = `question-ai-alert alert alert-${isError ? "danger" : "info"} py-1 mb-0`;
    div.setAttribute("role", "alert");
    div.textContent = message;
    const body = card.querySelector(".card-body");
    if (body) body.prepend(div);
  }

  function applyAiGerarOpcoesMc(q, data) {
    q.opcoes = [
      String(data.opcao1 || "").trim(),
      String(data.opcao2 || "").trim(),
      String(data.opcao3 || "").trim(),
      String(data.opcao4 || "").trim(),
    ];
    q.resposta = opcaoKeyToLetter(data.pergunta_correta, 4);
  }

  function isInvalidVfAfirmacaoText(text) {
    const s = String(text || "").trim();
    if (!s) {
      return true;
    }
    return /^(v|f|verdadeiro|falso|sim|n[aã]o|true|false)$/i.test(s);
  }

  function isInvalidVfCombinacaoText(text) {
    const s = String(text || "").trim();
    if (!s) {
      return true;
    }
    if (/afirmacao|opcao\d/i.test(s)) {
      return true;
    }
    return parseVfSequenceTokens(s).length !== 4;
  }

  function repairAiVfGeneratedData(data) {
    const out = { ...data };
    for (let i = 1; i <= 4; i++) {
      const typo = out[`affirmacao${i}`];
      if (typo != null && String(typo).trim() && !String(out[`afirmacao${i}`] || "").trim()) {
        out[`afirmacao${i}`] = String(typo).trim();
      }
    }
    const ccRaw = String(out.combinacao_correta || "").trim();
    const ccComb = ccRaw.match(/^combinacao(\d)$/i);
    if (ccComb) {
      out.combinacao_correta = `opcao${ccComb[1]}`;
    } else {
      const ccOpcao = ccRaw.match(/^opcao([1-4])$/i);
      if (ccOpcao) {
        out.combinacao_correta = `opcao${ccOpcao[1]}`;
      }
    }
    for (let i = 1; i <= 4; i++) {
      const k = `afirmacao${i}`;
      if (isInvalidVfAfirmacaoText(out[k])) {
        out[k] = "";
      }
    }
    const vfs = [1, 2, 3, 4].map((i) => {
      const v = String(out[`vf${i}`] || "")
        .trim()
        .toUpperCase();
      return v === "V" || v === "F" ? v : "";
    });
    const gabaritoFmt = vfs.every(Boolean) ? formatVfCombinacao(vfs) : "";
    const combos = [];
    for (let i = 1; i <= 4; i++) {
      let cv = String(out[`combinacao${i}`] || "").trim();
      if (isInvalidVfCombinacaoText(cv)) {
        cv = "";
      } else {
        cv = normalizeVfCombinacaoDisplay(cv);
      }
      combos.push(cv);
    }
    if (gabaritoFmt) {
      let correctIdx = combos.findIndex((c) => vfSequencesMatch(c, gabaritoFmt));
      if (correctIdx < 0) {
        combos[0] = gabaritoFmt;
        correctIdx = 0;
      }
      const flipFirst = formatVfCombinacao(
        vfs.map((t, j) => (j === 0 ? (t === "V" ? "F" : "V") : t))
      );
      const allV = formatVfCombinacao(["V", "V", "V", "V"]);
      const allF = formatVfCombinacao(["F", "F", "F", "F"]);
      const pool = [flipFirst, allV, allF].filter((c) => c && !vfSequencesMatch(c, gabaritoFmt));
      let pi = 0;
      for (let i = 0; i < 4; i++) {
        if (i === correctIdx) {
          combos[i] = gabaritoFmt;
        } else if (!combos[i] && pi < pool.length) {
          combos[i] = pool[pi++];
        } else if (!combos[i]) {
          combos[i] = i % 2 === 0 ? allV : allF;
        }
      }
      out.combinacao_correta = `opcao${correctIdx + 1}`;
    }
    for (let i = 1; i <= 4; i++) {
      out[`combinacao${i}`] = combos[i - 1] || "";
      if (vfs[i - 1]) {
        out[`vf${i}`] = vfs[i - 1];
      }
    }
    return out;
  }

  function applyAiGerarOpcoesVf(q, data) {
    let afirmacoes = [
      String(data.afirmacao1 || "").trim(),
      String(data.afirmacao2 || "").trim(),
      String(data.afirmacao3 || "").trim(),
      String(data.afirmacao4 || "").trim(),
    ];
    if (!afirmacoes.some(Boolean) && Array.isArray(data.afirmacoes)) {
      afirmacoes = normalizeStringArray(data.afirmacoes, DEFAULT_MC_OPCOES).slice(0, DEFAULT_MC_OPCOES);
    }
    q.opcoes = padOpcoesMin(afirmacoes, DEFAULT_MC_OPCOES).slice(0, DEFAULT_MC_OPCOES);

    const gabaritoTokens = [
      String(data.vf1 || "").trim().toUpperCase(),
      String(data.vf2 || "").trim().toUpperCase(),
      String(data.vf3 || "").trim().toUpperCase(),
      String(data.vf4 || "").trim().toUpperCase(),
    ].filter((v) => v === "V" || v === "F");
    const gabaritoFmt =
      gabaritoTokens.length === 4 ? formatVfCombinacao(gabaritoTokens) : "";

    let combinacoes = [
      normalizeVfCombinacaoDisplay(data.combinacao1),
      normalizeVfCombinacaoDisplay(data.combinacao2),
      normalizeVfCombinacaoDisplay(data.combinacao3),
      normalizeVfCombinacaoDisplay(data.combinacao4),
    ];
    if (!combinacoes.some(Boolean) && Array.isArray(data.combinacoes)) {
      combinacoes = data.combinacoes
        .map((c) => normalizeVfCombinacaoDisplay(c))
        .slice(0, DEFAULT_VF_COMBINACOES);
    }
    combinacoes = padOpcoesMin(combinacoes, DEFAULT_VF_COMBINACOES).slice(0, DEFAULT_VF_COMBINACOES);

    let respostaIdx = opcaoKeyToIndex(data.combinacao_correta);
    if (gabaritoFmt) {
      const matchIdx = combinacoes.findIndex((c) => vfSequencesMatch(c, gabaritoFmt));
      if (matchIdx >= 0) {
        respostaIdx = matchIdx;
      } else if (respostaIdx >= 0 && respostaIdx < 4) {
        combinacoes[respostaIdx] = gabaritoFmt;
      } else {
        respostaIdx = 0;
        combinacoes[0] = gabaritoFmt;
      }
    }
    q.combinacoes = combinacoes;
    q.resposta =
      respostaIdx >= 0 && respostaIdx < q.combinacoes.length
        ? letterLabel(respostaIdx)
        : opcaoKeyToLetter(data.combinacao_correta, q.combinacoes.length);
  }

  function applyAiGerarOpcoesRelacionar(q, data) {
    const left = normalizeStringArray(data.coluna_esquerda, DEFAULT_MC_OPCOES);
    const right = normalizeStringArray(data.coluna_direita, DEFAULT_MC_OPCOES);
    const n = Math.max(left.length, right.length, DEFAULT_MC_OPCOES);
    q.opcoes = left.slice(0, n);
    while (q.opcoes.length < n) q.opcoes.push("");
    q.coluna_direita = right.slice(0, n);
    while (q.coluna_direita.length < n) q.coluna_direita.push("");
    q.combinacoes = normalizeStringArray(data.combinacoes, DEFAULT_VF_COMBINACOES);
    q.resposta = opcaoKeyToLetter(data.combinacao_correta, q.combinacoes.length);
  }

  function applyGeneratedQuestionFromAi(q, data, tipo) {
    const t = normalizeTipo(tipo);
    q.tipo = t;
    q.pergunta = String(data.pergunta || "").trim();
    if (t === "multipla-escolha") {
      applyAiGerarOpcoesMc(q, data);
    } else if (t === "verdadeiro_falso") {
      applyAiGerarOpcoesVf(q, repairAiVfGeneratedData(data));
    } else if (t === "relacionar") {
      applyAiGerarOpcoesRelacionar(q, data);
    } else if (t === "discursiva") {
      const linhas = parseInt(data.linhas, 10);
      q.linhas = !Number.isNaN(linhas) && linhas >= 1 ? linhas : 3;
      q.opcoes = blankOpcoes(DEFAULT_MC_OPCOES);
      q.combinacoes = blankOpcoes(DEFAULT_VF_COMBINACOES);
      q.resposta = "";
    }
  }

  function appendGeneratedQuestions(items, tipo) {
    readQuestionsFromDom();
    const list = Array.isArray(items) ? items : [];
    const t = normalizeTipo(tipo);
    for (const data of list) {
      const q = createEmptyQuestion();
      applyGeneratedQuestionFromAi(q, data, t);
      state.questions.push(q);
    }
    render();
    document.querySelectorAll(".question-card").forEach(syncPanels);
  }

  function clearGerarQuestaoAlert() {
    const el = document.getElementById("gerarQuestaoAlert");
    if (!el) {
      return;
    }
    el.textContent = "";
    el.classList.add("d-none");
  }

  function showGerarQuestaoAlert(message) {
    const el = document.getElementById("gerarQuestaoAlert");
    if (!el || !message) {
      return;
    }
    el.textContent = message;
    el.classList.remove("d-none");
  }

  function getBootstrapModalGerarQuestao() {
    const el = document.getElementById("gerarQuestaoModal");
    if (!el || typeof bootstrap === "undefined") {
      return null;
    }
    if (!gerarQuestaoModalInstance) {
      gerarQuestaoModalInstance = new bootstrap.Modal(el);
    }
    return gerarQuestaoModalInstance;
  }

  function getBootstrapModalGerarProva() {
    const el = document.getElementById("gerarProvaModal");
    if (!el || typeof bootstrap === "undefined") {
      return null;
    }
    if (!gerarProvaModalInstance) {
      gerarProvaModalInstance = new bootstrap.Modal(el);
    }
    return gerarProvaModalInstance;
  }

  function clearGerarProvaAlert() {
    const el = document.getElementById("gerarProvaAlert");
    if (!el) {
      return;
    }
    el.textContent = "";
    el.classList.add("d-none");
  }

  function showGerarProvaAlert(message) {
    const el = document.getElementById("gerarProvaAlert");
    if (!el || !message) {
      return;
    }
    el.textContent = message;
    el.classList.remove("d-none");
  }

  function renderGerarProvaCtaHtml() {
    if (!aiOnline || isPrPackageLoaded()) {
      return "";
    }
    return (
      `<button type="button" class="gerar-prova-cta card mb-3 w-100 border-0 text-start" id="btnGerarProvaCta">` +
      `<span class="gerar-prova-cta-icon" aria-hidden="true">` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="36" height="36"><path fill="currentColor" d="M360-360v-240h240v240H360Zm80-80h80v-80h-80v80Zm-80 320v-80h-80q-33 0-56.5-23.5T200-280v-80h-80v-80h80v-80h-80v-80h80v-80q0-33 23.5-56.5T280-760h80v-80h80v80h80v-80h80v80h80q33 0 56.5 23.5T760-680v80h80v80h-80v80h80v80h-80v80q0 33-23.5 56.5T680-200h-80v80h-80v-80h-80v80h-80Zm320-160v-400H280v400h400ZM480-480Z"/></svg>` +
      `</span>` +
      `<span class="gerar-prova-cta-title">Gerar prova</span>` +
      `<span class="gerar-prova-cta-hint small text-pr-muted">Tema, fontes ou anexos — a IA cria as questões</span>` +
      `</button>`
    );
  }

  function applyGeneratedBatch(items, tipo, replaceEmptySingle) {
    readQuestionsFromDom();
    const list = Array.isArray(items) ? items : [];
    const t = normalizeTipo(tipo);
    const generated = [];
    for (const data of list) {
      const q = createEmptyQuestion();
      applyGeneratedQuestionFromAi(q, data, t);
      generated.push(q);
    }
    if (replaceEmptySingle && isSingleEmptyQuestion()) {
      state.questions = generated.length ? generated : [createEmptyQuestion()];
    } else {
      state.questions.push(...generated);
    }
    render();
    document.querySelectorAll(".question-card").forEach(syncPanels);
  }

  function setButtonLoading(btn, loading, options) {
    if (!btn) {
      return;
    }
    const opts = options || {};
    if (loading) {
      if (btn.dataset.idleLabel === undefined) {
        btn.dataset.idleLabel = opts.idleText != null ? String(opts.idleText) : btn.textContent;
      }
      btn.classList.add("is-loading");
      btn.disabled = true;
      const loadingText = opts.loadingText != null ? opts.loadingText : "Aguarde…";
      btn.innerHTML =
        '<span class="btn-spinner" aria-hidden="true"></span>' +
        `<span class="btn-loading-text">${loadingText}</span>`;
    } else {
      btn.classList.remove("is-loading");
      const restore = opts.idleText != null ? String(opts.idleText) : btn.dataset.idleLabel || "";
      btn.textContent = restore;
      delete btn.dataset.idleLabel;
      if (Object.prototype.hasOwnProperty.call(opts, "disabledWhenIdle")) {
        btn.disabled = !!opts.disabledWhenIdle;
      } else {
        btn.disabled = false;
      }
    }
  }

  function updateProvaTabBadge() {
    const badge = document.getElementById("provaTabBadge");
    if (badge) {
      badge.textContent = String(state.questions.length);
    }
  }

  function setGerarQuestaoToolbarLoading(loading) {
    gerarQuestaoInFlight = !!loading;
    const btn = document.getElementById("btnGerarQuestao");
    if (!btn) {
      return;
    }
    if (loading) {
      setButtonLoading(btn, true, { loadingText: "Gerando…" });
    } else {
      setButtonLoading(btn, false, { idleText: "Gerar questão", disabledWhenIdle: !aiOnline });
    }
  }

  function openGerarQuestaoModal() {
    if (!aiOnline || gerarQuestaoInFlight) {
      return;
    }
    clearGerarQuestaoAlert();
    const temaEl = document.getElementById("gerarQuestaoTema");
    if (temaEl) {
      temaEl.value = "";
    }
    const qtdEl = document.getElementById("gerarQuestaoQuantidade");
    if (qtdEl) {
      qtdEl.value = "1";
    }
    clearModalAnexos("gerarQuestao");
    renderGerarQuestaoFontesList();
    renderModalAnexosList("gerarQuestao");
    getBootstrapModalGerarQuestao()?.show();
  }

  function openGerarProvaModal() {
    if (!aiOnline || gerarProvaInFlight || isPrPackageLoaded()) {
      return;
    }
    clearGerarProvaAlert();
    const temaEl = document.getElementById("gerarProvaTema");
    if (temaEl) {
      temaEl.value = "";
    }
    const qtdEl = document.getElementById("gerarProvaQuantidade");
    if (qtdEl) {
      qtdEl.value = "5";
    }
    clearModalAnexos("gerarProva");
    renderAiFontesChecklist("gerarProva");
    renderModalAnexosList("gerarProva");
    getBootstrapModalGerarProva()?.show();
  }

  async function runGerarQuestaoConfirm() {
    const gpb = globalThis.editorChatGpb;
    if (!gpb || !aiOnline || gerarQuestaoInFlight) {
      return;
    }
    clearGerarQuestaoAlert();
    const tipo = document.getElementById("gerarQuestaoTipo")?.value || "multipla-escolha";
    let quantidade = parseInt(document.getElementById("gerarQuestaoQuantidade")?.value, 10);
    if (Number.isNaN(quantidade) || quantidade < 1) {
      quantidade = 1;
    }
    if (quantidade > 5) {
      quantidade = 5;
    }
    const { tema, trechosFontes, selectedIds } = collectTrechosForAi("gerarQuestao");
    readQuestionsFromDom();
    const perguntasExistentes = state.questions
      .map((q) => ({
        pergunta: String(q.pergunta || "").trim(),
        tipo: normalizeTipo(q.tipo)
      }))
      .filter((p) => p.pergunta);

    const hasTema = !!tema;
    const hasFontesSel = trechosFontes.length > 0;
    const hasAnexosPendentes = (modalAnexosPendentes.gerarQuestao || []).length > 0;
    if (!hasTema && !hasFontesSel) {
      if (!perguntasExistentes.length) {
        showGerarQuestaoAlert("Informe o tema, anexe arquivos ou selecione fontes.");
        return;
      }
    } else if (!hasTema && state.fontes.length > 0 && selectedIds.size === 0 && !hasAnexosPendentes) {
      showGerarQuestaoAlert("Sem tema: selecione fontes ou use Anexar.");
      return;
    } else if (selectedIds.size > 0) {
      const selComTexto = state.fontes.some(
        (f) => selectedIds.has(f.id) && String(f.text || "").trim()
      );
      if (!selComTexto && !hasAnexosPendentes) {
        showGerarQuestaoAlert("As fontes selecionadas estão vazias ou não puderam ser lidas.");
        return;
      }
    }

    const confirmBtn = document.getElementById("gerarQuestaoConfirm");
    setButtonLoading(confirmBtn, true, { idleText: "Gerar", loadingText: "Gerando…" });
    getBootstrapModalGerarQuestao()?.hide();
    setGerarQuestaoToolbarLoading(true);
    showValidationErrors([]);

    const enviarPerguntasExistentes = !hasTema && !hasFontesSel;

    try {
      const data = await gpb.gerarQuestoes({
        tema,
        tipo: normalizeTipo(tipo),
        quantidade,
        perguntasExistentes: enviarPerguntasExistentes ? perguntasExistentes : [],
        trechosFontes
      });
      const questoes = data && Array.isArray(data.questoes) ? data.questoes : [];
      if (!questoes.length) {
        showValidationErrors(["A IA não retornou questões. Tente de novo."]);
        return;
      }
      persistModalAnexosToState("gerarQuestao");
      applyGeneratedBatch(questoes.slice(0, quantidade), tipo, false);
    } catch (err) {
      showValidationErrors([err && err.message ? err.message : "Falha na IA ao gerar questão."]);
    } finally {
      setButtonLoading(document.getElementById("gerarQuestaoConfirm"), false, { idleText: "Gerar" });
      setGerarQuestaoToolbarLoading(false);
    }
  }

  async function runGerarProvaConfirm() {
    const gpb = globalThis.editorChatGpb;
    if (!gpb || !aiOnline || gerarProvaInFlight) {
      return;
    }
    clearGerarProvaAlert();
    const tipo = document.getElementById("gerarProvaTipo")?.value || "multipla-escolha";
    let quantidade = parseInt(document.getElementById("gerarProvaQuantidade")?.value, 10);
    if (Number.isNaN(quantidade) || quantidade < 1) {
      quantidade = 1;
    }
    if (quantidade > 15) {
      quantidade = 15;
    }
    const { tema, trechosFontes, selectedIds } = collectTrechosForAi("gerarProva");
    const hasTema = !!tema;
    const hasFontesSel = trechosFontes.length > 0;
    const hasAnexosPendentes = (modalAnexosPendentes.gerarProva || []).length > 0;
    if (!hasTema && !hasFontesSel) {
      showGerarProvaAlert("Informe o tema, anexe arquivos ou selecione fontes.");
      return;
    }
    if (!hasTema && state.fontes.length > 0 && selectedIds.size === 0 && !hasAnexosPendentes) {
      showGerarProvaAlert("Sem tema: selecione fontes ou use Anexar.");
      return;
    }

    const confirmBtn = document.getElementById("gerarProvaConfirm");
    gerarProvaInFlight = true;
    setButtonLoading(confirmBtn, true, { idleText: "Gerar", loadingText: "Gerando…" });
    getBootstrapModalGerarProva()?.hide();
    showValidationErrors([]);

    try {
      const data = await gpb.gerarQuestoes({
        tema,
        tipo: normalizeTipo(tipo),
        quantidade,
        perguntasExistentes: [],
        trechosFontes
      });
      const questoes = data && Array.isArray(data.questoes) ? data.questoes : [];
      if (!questoes.length) {
        showValidationErrors(["A IA não retornou questões. Tente de novo."]);
        return;
      }
      persistModalAnexosToState("gerarProva");
      applyGeneratedBatch(questoes.slice(0, quantidade), tipo, true);
    } catch (err) {
      showValidationErrors([err && err.message ? err.message : "Falha na IA ao gerar prova."]);
    } finally {
      gerarProvaInFlight = false;
      setButtonLoading(confirmBtn, false, { idleText: "Gerar", disabledWhenIdle: !aiOnline });
    }
  }

  async function runAiAction(btn, card, i, fn) {
    const gpb = globalThis.editorChatGpb;
    if (!gpb || !aiOnline) return;
    readMetaFromDom();
    readQuestionsFromDom();
    const q = state.questions[i];
    if (!q) return;
    const pergunta = String(q.pergunta || "").trim();
    if (!pergunta) {
      showQuestionAiAlert(card, "Preencha o enunciado antes de usar a IA.", true);
      return;
    }
    clearQuestionAiAlert(card);
    const labelDefault = btn.textContent;
    setButtonLoading(btn, true, { idleText: labelDefault, loadingText: "Gerando…" });
    try {
      const data = await fn(pergunta, q.tipo);
      const tipo = normalizeTipo(q.tipo);
      if (tipo === "multipla-escolha") applyAiGerarOpcoesMc(q, data);
      else if (tipo === "verdadeiro_falso") applyAiGerarOpcoesVf(q, data);
      else if (tipo === "relacionar") applyAiGerarOpcoesRelacionar(q, data);
      render();
      document.querySelectorAll(".question-card").forEach(syncPanels);
    } catch (err) {
      showQuestionAiAlert(card, err && err.message ? err.message : "Falha na IA.", true);
    } finally {
      setButtonLoading(btn, false, { idleText: labelDefault });
    }
  }

  async function runAiMelhorarCampo(btn, card, i) {
    const gpb = globalThis.editorChatGpb;
    if (!gpb || !aiOnline) return;
    readMetaFromDom();
    readQuestionsFromDom();
    const q = state.questions[i];
    if (!q) return;
    const target = btn.getAttribute("data-ai-target") || "pergunta";
    const optIndex = btn.getAttribute("data-opt");
    let fieldEl = null;
    if (target === "pergunta") {
      fieldEl = card.querySelector('[data-field="pergunta"]');
    } else if (target === "opcao" || target === "col_dir") {
      const sel = `[data-field="${target}"][data-q="${i}"][data-opt="${optIndex}"]`;
      fieldEl = card.querySelector(sel);
    }
    const textoAtual = fieldEl ? String(fieldEl.value || "").trim() : "";
    if (!textoAtual) {
      showQuestionAiAlert(card, "Preencha o campo antes de usar Melhorar.", true);
      return;
    }
    clearQuestionAiAlert(card);
    const labelDefault = btn.textContent;
    setButtonLoading(btn, true, { idleText: labelDefault, loadingText: "…" });
    try {
      const papel = aiTargetToPapel(target, q.tipo);
      const data = await gpb.melhorarCampo(textoAtual, {
        tipo: q.tipo,
        pergunta: q.pergunta,
        papel,
      });
      const novo = data && data.texto ? String(data.texto).trim() : "";
      if (!novo) {
        showQuestionAiAlert(card, "A IA nao retornou texto.", true);
        return;
      }
      if (fieldEl) fieldEl.value = novo;
      applyMelhorarCampoToState(q, target, optIndex, novo);
    } catch (err) {
      showQuestionAiAlert(card, err && err.message ? err.message : "Falha na IA.", true);
    } finally {
      setButtonLoading(btn, false, { idleText: labelDefault });
    }
  }

  function readMetaFromDom() {
    state.includeMeta = document.getElementById("includeMeta").checked;
    for (const key of META_KEYS) {
      const el = document.querySelector(`[data-meta-key="${key}"]`);
      state.meta[key] = el ? el.value : "";
    }
    const fn = document.getElementById("outFilename");
    state.filename = (fn && fn.value.trim()) || "fonte.pr";
  }

  function readQuestionsFromDom() {
    const cards = document.querySelectorAll("[data-question-index]");
    const prevBy = new Map(state.questions.map((pq) => [pq.stableKey, pq]));
    const next = [];
    cards.forEach((card, idx) => {
      const sk = card.getAttribute("data-stable-key");
      const pq = sk && prevBy.has(sk) ? prevBy.get(sk) : null;
      const q = createEmptyQuestion();
      if (pq) {
        q.stableKey = pq.stableKey;
      }
      q.id = `Q${idx + 1}`;
      q.pergunta = card.querySelector(`[data-field="pergunta"]`)?.value ?? "";
      q.tipo = card.querySelector(`[data-field="tipo"]`)?.value ?? "multipla-escolha";
      const tipoNormEarly = normalizeTipo(q.tipo);
      if (tipoNormEarly === "multipla-escolha") {
        const mc = card.querySelector(`[data-field="resposta_mc"]`);
        q.resposta = mc ? String(mc.value) : "";
      } else if (tipoNormEarly === "discursiva") {
        q.resposta = "";
      } else if (tipoNormEarly === "verdadeiro_falso" || tipoNormEarly === "relacionar") {
        const vf = card.querySelector(`[data-field="resposta_vf"]`);
        q.resposta = vf ? String(vf.value) : "";
      } else {
        q.resposta = "";
      }
      q.eh_opcional = card.querySelector(`[data-field="eh_opcional"]`)?.checked ?? false;
      q.apenas_renderizar_sozinha =
        card.querySelector(`[data-field="apenas_renderizar_sozinha"]`)?.checked ?? false;
      const pesoInput = card.querySelector(`[data-field="peso"]`)?.value ?? "";
      try {
        q.peso = parsePeso(pesoInput);
      } catch {
        q.peso = null;
      }
      const linhasEl = card.querySelector(`[data-field="linhas"]`);
      const tipoNorm = normalizeTipo(q.tipo);
      if (tipoNorm === "discursiva") {
        q.linhas = linhasEl ? parseInt(linhasEl.value, 10) || 0 : 0;
        if (!Number.isInteger(q.linhas) || q.linhas < 1) {
          q.linhas = 3;
        }
       } else {
        q.linhas = null;
      }
      const optInputs = card.querySelectorAll(`[data-field="opcao"]`);
      q.opcoes = Array.from(optInputs).map((inp) => inp.value);
      const dirInputs = card.querySelectorAll(`[data-field="col_dir"]`);
      if (tipoNorm === "relacionar") {
        const left = q.opcoes;
        const cd = Array.from(dirInputs).map((inp) => inp.value);
        while (cd.length < left.length) {
          cd.push("");
        }
        if (cd.length > left.length) {
          cd.splice(left.length);
        }
        q.coluna_direita = cd;
      } else {
        q.coluna_direita = blankOpcoes(DEFAULT_MC_OPCOES);
      }
      const combInputs = card.querySelectorAll(`[data-field="combinacao"]`);
      q.combinacoes = Array.from(combInputs).map((inp) => inp.value);
      if (tipoNorm !== "verdadeiro_falso" && tipoNorm !== "relacionar") {
        q.combinacoes = blankOpcoes(DEFAULT_VF_COMBINACOES);
      }
      if (tipoNorm === "multipla-escolha") {
        const n = q.opcoes.length;
        q.resposta = normalizeMcRespostaLetter(q.resposta, n);
      }
      if (tipoNorm === "verdadeiro_falso" || tipoNorm === "relacionar") {
        const n = q.combinacoes.length;
        q.resposta = normalizeMcRespostaLetter(q.resposta, n);
      }
      const encSel = card.querySelector('[data-field="encadeia_com_stable_key"]');
      const ev = encSel && encSel.value ? String(encSel.value).trim() : "";
      q.encadeia_com_stable_key = ev || null;
      if (pq) {
        if (pq.foto_enunciado_bytes && pq.foto_enunciado_bytes.byteLength) {
          q.foto_enunciado_bytes = pq.foto_enunciado_bytes;
          q.foto_enunciado_ext = pq.foto_enunciado_ext;
          q.foto_enunciado_basename_md = pq.foto_enunciado_basename_md;
        } else if (pq.foto_enunciado_basename_md && String(pq.foto_enunciado_basename_md).trim() !== "") {
          q.foto_enunciado_basename_md = pq.foto_enunciado_basename_md;
        }
      }
      next.push(q);
    });
    applyEncadeamentoOpcionalRules(next);
    state.questions = next.length ? next : [createEmptyQuestion()];
  }

  function validateQuestion(q, index) {
    const id = `Q${index + 1}`;
    const errors = [];
    if (!q.pergunta || !String(q.pergunta).trim()) {
      errors.push(`${id}: campo pergunta é obrigatório.`);
    }
    const tipo = normalizeTipo(q.tipo);
    if (!tipo || !TIPOS.has(tipo)) {
      errors.push(`${id}: tipo inválido. Use múltipla escolha, discursiva, verdadeiro/falso ou relacionar.`);
      return errors;
    }
    let opcoes = q.opcoes ? q.opcoes.map((s) => String(s).trim()).filter(Boolean) : [];
    let linhas = q.linhas;
    if (tipo === "discursiva") {
      if (!Number.isInteger(linhas) || linhas < 1) {
        errors.push(`${id}: discursiva exige linhas (inteiro ≥ 1).`);
      }
    } else if (tipo === "verdadeiro_falso") {
      if (opcoes.length < 2) {
        errors.push(`${id}: verdadeiro/falso exige pelo menos duas afirmações.`);
      }
      const combs = q.combinacoes
        ? q.combinacoes.map((s) => String(s).trim()).filter(Boolean)
        : [];
      if (combs.length < 2) {
        errors.push(`${id}: verdadeiro/falso exige pelo menos duas combinações (campo combinacoes).`);
      }
    } else if (tipo === "relacionar") {
      const opTrim = (q.opcoes || []).map((s) => String(s).trim());
      const dirTrim = (q.coluna_direita || []).map((s) => String(s).trim());
      if (opTrim.length !== dirTrim.length || opTrim.length < 2) {
        errors.push(
          `${id}: relacionar exige coluna esquerda e coluna direita com o mesmo número de linhas (mínimo 2).`
        );
      } else if (!opTrim.every((o, idx) => o && dirTrim[idx])) {
        errors.push(
          `${id}: relacionar exige texto em cada linha da esquerda e da direita (pares alinhados).`
        );
      }
      const combs = q.combinacoes
        ? q.combinacoes.map((s) => String(s).trim()).filter(Boolean)
        : [];
      if (combs.length < 2) {
        errors.push(`${id}: relacionar exige pelo menos duas alternativas em combinacoes.`);
      }
    } else {
      if (opcoes.length < 2) {
        errors.push(`${id}: ${tipo} exige pelo menos duas opções.`);
      }
    }
    try {
      parsePeso(q.peso);
    } catch {
      errors.push(`${id}: peso inválido (esperado 0,0 a 10,0 ou vazio).`);
    }
    if (q.encadeia_com_stable_key) {
      const j = state.questions.findIndex((x) => x.stableKey === q.encadeia_com_stable_key);
      if (j < 0) {
        errors.push(`${id}: encadeamento aponta para questão inexistente.`);
      } else if (j === index) {
        errors.push(`${id}: encadeamento inválido.`);
      }
    }
    return errors;
  }

  function validateAll() {
    readMetaFromDom();
    readQuestionsFromDom();
    const errors = [];
    state.questions.forEach((q, i) => {
      errors.push(...validateQuestion(q, i));
    });
    return errors;
  }

  function extFromMimeOrFile(mime, name) {
    const m = String(mime || "").toLowerCase();
    if (m.includes("png")) return "png";
    if (m.includes("webp")) return "webp";
    if (m.includes("gif")) return "gif";
    if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
    const ext = (String(name || "").split(".").pop() || "").toLowerCase();
    if (ext === "jpeg" || ext === "jpg") return "jpg";
    if (["png", "webp", "gif"].includes(ext)) return ext;
    return "png";
  }

  function extFromFotoBasename(bn) {
    const m = String(bn || "")
      .toLowerCase()
      .match(/\.([a-z0-9]+)$/i);
    if (!m) return "png";
    if (m[1] === "jpeg") return "jpg";
    return m[1];
  }

  function exportFotoBasenameForZip(q, questionIndex) {
    if (q.foto_enunciado_bytes && q.foto_enunciado_bytes.byteLength && q.foto_enunciado_ext) {
      return `Q${questionIndex + 1}-enunciado.${q.foto_enunciado_ext}`;
    }
    if (q.foto_enunciado_basename_md && String(q.foto_enunciado_basename_md).trim() !== "") {
      const s = String(q.foto_enunciado_basename_md).trim().replace(/\\/g, "/");
      return s.split("/").filter(Boolean).pop() || null;
    }
    return null;
  }

  async function hydrateFotosFromZip(zip, questions) {
    for (const q of questions) {
      const bn = q.foto_enunciado_basename_md;
      if (!bn || String(bn).trim() === "") {
        continue;
      }
      const base = String(bn).trim().replace(/\\/g, "/").split("/").filter(Boolean).pop();
      const pathZip = `fotos/${base}`;
      let entry = zip.file(pathZip);
      if (!entry) {
        entry = zip.file(pathZip.replace(/\//g, "\\"));
      }
      if (!entry || entry.dir) {
        continue;
      }
      const buf = await entry.async("uint8array");
      q.foto_enunciado_bytes = buf;
      q.foto_enunciado_ext = extFromFotoBasename(base);
    }
  }

  function newFonteId() {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `fonte-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  function sanitizeFonteBasename(name) {
    return String(name || "")
      .replace(/[/\\?%*:|"<>]/g, "_")
      .trim() || "fonte.txt";
  }

  function uniqueFonteBasename(name) {
    const base = sanitizeFonteBasename(name);
    const existing = new Set(state.fontes.map((f) => f.basename.toLowerCase()));
    if (!existing.has(base.toLowerCase())) {
      return base;
    }
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot) : "";
    const stem = ext ? base.slice(0, -ext.length) : base;
    let n = 2;
    while (existing.has(`${stem}-${n}${ext}`.toLowerCase())) {
      n += 1;
    }
    return `${stem}-${n}${ext}`;
  }

  function isFonteFileAccepted(file) {
    const name = String(file.name || "").toLowerCase();
    return FONTE_EXT_OK.test(name);
  }

  function formatFonteSizeKb(size) {
    const kb = Math.max(0, Number(size) || 0) / 1024;
    if (kb < 1) {
      return `${Math.round(Number(size) || 0)} B`;
    }
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }

  function updateFontesBadges() {
    const n = state.fontes.length;
    const tabBadge = document.getElementById("fontesTabBadge");
    if (tabBadge) {
      tabBadge.textContent = String(n);
    }
    const total = document.getElementById("fontesListTotal");
    if (total) {
      total.textContent = String(n);
    }
  }

  function renderFontesPane() {
    updateFontesBadges();
    const list = document.getElementById("fontesList");
    const empty = document.getElementById("fontesListEmpty");
    if (!list || !empty) {
      return;
    }
    if (!state.fontes.length) {
      list.innerHTML = "";
      empty.classList.remove("d-none");
      return;
    }
    empty.classList.add("d-none");
    list.innerHTML = state.fontes
      .map(
        (f) =>
          `<li class="fonte-list-item d-flex flex-wrap align-items-center gap-2 py-2 border-bottom border-secondary">` +
          `<span class="flex-grow-1">${escapeHtml(f.basename)} <span class="small text-pr-muted">(${formatFonteSizeKb(f.size)})</span></span>` +
          `<button type="button" class="btn btn-outline-danger btn-sm" data-action="remove-fonte" data-fonte-id="${escapeAttr(f.id)}">Remover</button>` +
          `</li>`
      )
      .join("");
  }

  function removeFonte(id) {
    state.fontes = state.fontes.filter((f) => f.id !== id);
    renderFontesPane();
    renderGerarQuestaoFontesList();
    renderAiFontesChecklist("gerarProva");
  }

  function isPrPackageLoaded() {
    return !!state.prLoaded;
  }

  function isSingleEmptyQuestion() {
    readQuestionsFromDom();
    if (state.questions.length !== 1) {
      return false;
    }
    return !String(state.questions[0].pergunta || "").trim();
  }

  async function readTextFromFonteFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("leitura"));
      fr.readAsText(file, "UTF-8");
    });
  }

  function renderModalAnexosList(prefix) {
    const list = document.getElementById(`${prefix}AnexosList`);
    if (!list) {
      return;
    }
    const items = modalAnexosPendentes[prefix] || [];
    if (!items.length) {
      list.innerHTML = "";
      list.classList.add("d-none");
      return;
    }
    list.classList.remove("d-none");
    list.innerHTML = items
      .map(
        (a) =>
          `<span class="modal-anexo-chip badge rounded-pill text-bg-secondary d-inline-flex align-items-center gap-1 me-1 mb-1">` +
          `<span>${escapeHtml(a.basename)}</span>` +
          `<button type="button" class="btn-close btn-close-white btn-close-sm modal-anexo-chip-remove" data-action="remove-modal-anexo" data-prefix="${escapeAttr(prefix)}" data-anexo-id="${escapeAttr(a.id)}" aria-label="Remover ${escapeAttr(a.basename)}"></button>` +
          `</span>`
      )
      .join("");
  }

  function clearModalAnexos(prefix) {
    modalAnexosPendentes[prefix] = [];
    renderModalAnexosList(prefix);
  }

  async function addModalAnexosFromFiles(prefix, fileList) {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) {
      return [];
    }
    const errors = [];
    const existingNames = new Set(
      [
        ...state.fontes.map((f) => f.basename.toLowerCase()),
        ...(modalAnexosPendentes[prefix] || []).map((a) => a.basename.toLowerCase())
      ]
    );
    for (const file of files) {
      if (!isFonteFileAccepted(file)) {
        errors.push(`"${file.name}": use apenas .txt ou .md.`);
        continue;
      }
      if (file.size > FONTES_MAX_BYTES) {
        errors.push(`"${file.name}": máximo 20 MB.`);
        continue;
      }
      try {
        const text = await readTextFromFonteFile(file);
        let basename = sanitizeFonteBasename(file.name);
        if (existingNames.has(basename.toLowerCase())) {
          const dot = basename.lastIndexOf(".");
          const ext = dot > 0 ? basename.slice(dot) : "";
          const stem = ext ? basename.slice(0, -ext.length) : basename;
          let n = 2;
          while (existingNames.has(`${stem}-${n}${ext}`.toLowerCase())) {
            n += 1;
          }
          basename = `${stem}-${n}${ext}`;
        }
        existingNames.add(basename.toLowerCase());
        if (!modalAnexosPendentes[prefix]) {
          modalAnexosPendentes[prefix] = [];
        }
        modalAnexosPendentes[prefix].push({
          id: newFonteId(),
          basename,
          text,
          size: file.size
        });
      } catch {
        errors.push(`"${file.name}": não foi possível ler.`);
      }
    }
    renderModalAnexosList(prefix);
    return errors;
  }

  function removeModalAnexo(prefix, id) {
    modalAnexosPendentes[prefix] = (modalAnexosPendentes[prefix] || []).filter((a) => a.id !== id);
    renderModalAnexosList(prefix);
  }

  function persistModalAnexosToState(prefix) {
    const pending = modalAnexosPendentes[prefix] || [];
    if (!pending.length) {
      return;
    }
    for (const a of pending) {
      state.fontes.push({
        id: newFonteId(),
        basename: uniqueFonteBasename(a.basename),
        mime: a.basename.toLowerCase().endsWith(".md") ? "text/markdown" : "text/plain",
        size: a.size || String(a.text || "").length,
        text: a.text
      });
    }
    modalAnexosPendentes[prefix] = [];
    renderFontesPane();
    renderAiFontesChecklist("gerarQuestao");
    renderAiFontesChecklist("gerarProva");
    renderModalAnexosList(prefix);
  }

  function renderAiFontesChecklist(prefix) {
    const list = document.getElementById(`${prefix}FontesList`);
    const empty = document.getElementById(`${prefix}FontesEmpty`);
    if (!list || !empty) {
      return;
    }
    if (!state.fontes.length) {
      list.innerHTML = "";
      empty.classList.remove("d-none");
      return;
    }
    empty.classList.add("d-none");
    list.innerHTML = state.fontes
      .map(
        (f) =>
          `<label class="gerar-questao-fonte-item d-flex align-items-start gap-2 mb-2">` +
          `<input type="checkbox" class="form-check-input mt-1 flex-shrink-0 gerar-questao-fonte-check" value="${escapeAttr(f.id)}">` +
          `<span class="flex-grow-1"><span class="d-block">${escapeHtml(f.basename)}</span>` +
          `<span class="small text-pr-muted">${formatFonteSizeKb(f.size)}</span></span>` +
          `</label>`
      )
      .join("");
  }

  function renderGerarQuestaoFontesList() {
    renderAiFontesChecklist("gerarQuestao");
  }

  function collectTrechosForAi(prefix) {
    const tema = String(document.getElementById(`${prefix}Tema`)?.value || "").trim();
    const selectedIds = new Set();
    document
      .querySelectorAll(`#${prefix}FontesList .gerar-questao-fonte-check:checked`)
      .forEach((inp) => {
        selectedIds.add(inp.value);
      });
    const trechosEstado = state.fontes
      .filter((f) => selectedIds.has(f.id))
      .map((f) => ({
        basename: f.basename,
        texto: String(f.text || "").trim()
      }))
      .filter((f) => f.texto);
    const trechosAnexos = (modalAnexosPendentes[prefix] || [])
      .map((a) => ({
        basename: a.basename,
        texto: String(a.text || "").trim()
      }))
      .filter((f) => f.texto);
    return { tema, trechosFontes: [...trechosEstado, ...trechosAnexos], selectedIds };
  }

  async function hydrateFontesFromZip(zip) {
    const fontes = [];
    const manifestByBasename = new Map();
    let manifestEntry = zip.file("fontes/manifest.json");
    if (!manifestEntry) {
      manifestEntry = zip.file("fontes\\manifest.json");
    }
    if (manifestEntry && !manifestEntry.dir) {
      try {
        const man = JSON.parse(await manifestEntry.async("string"));
        if (man && Array.isArray(man.items)) {
          for (const it of man.items) {
            if (it && it.basename) {
              manifestByBasename.set(String(it.basename).toLowerCase(), it);
            }
          }
        }
      } catch (_) {}
    }
    const keys = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
    for (const k of keys) {
      const norm = k.replace(/\\/g, "/");
      if (!/^fontes\//i.test(norm)) {
        continue;
      }
      const rel = norm.replace(/^fontes\//i, "");
      if (!rel || rel === ".gitkeep" || rel.toLowerCase() === "manifest.json") {
        continue;
      }
      if (!FONTE_EXT_OK.test(rel)) {
        continue;
      }
      const entry = zip.file(k);
      if (!entry) {
        continue;
      }
      const text = await entry.async("string");
      const base = rel.split("/").filter(Boolean).pop() || rel;
      const meta = manifestByBasename.get(base.toLowerCase());
      fontes.push({
        id: meta && meta.id ? meta.id : newFonteId(),
        basename: base,
        mime:
          meta && meta.mime
            ? meta.mime
            : base.toLowerCase().endsWith(".md")
              ? "text/markdown"
              : "text/plain",
        size: meta && meta.size != null ? meta.size : text.length,
        text
      });
    }
    state.fontes = fontes;
    renderFontesPane();
    renderGerarQuestaoFontesList();
    renderAiFontesChecklist("gerarProva");
  }

  function exportFontesToZip(zip) {
    if (!state.fontes.length) {
      return;
    }
    const folder = zip.folder("fontes");
    const items = [];
    for (const f of state.fontes) {
      folder.file(f.basename, f.text);
      items.push({ id: f.id, basename: f.basename, mime: f.mime, size: f.size });
    }
    folder.file("manifest.json", JSON.stringify({ version: 1, items }, null, 2));
  }

  function serializeQuestionBlock(q, questionIndex) {
    const tipo = normalizeTipo(q.tipo);
    const lines = [];
    const perguntaLines = String(q.pergunta).split(/\r?\n/);
    const first = perguntaLines[0] ?? "";
    lines.push(`pergunta: ${first}`);
    for (let i = 1; i < perguntaLines.length; i++) {
      lines.push(perguntaLines[i]);
    }
    lines.push(`tipo: ${tipo}`);
    const fotoBasename = exportFotoBasenameForZip(q, questionIndex);
    if (fotoBasename) {
      lines.push(`foto_enunciado: ${fotoBasename}`);
    }
    if (tipo === "discursiva") {
      lines.push(`linhas: ${q.linhas}`);
    } else if (tipo === "verdadeiro_falso") {
      const opcoes = q.opcoes.map((s) => String(s).trim()).filter(Boolean);
      lines.push(`opcoes: ${opcoes.join("; ")}`);
      const combs = (q.combinacoes || [])
        .map((s) => String(s).trim())
        .filter(Boolean);
      lines.push(`combinacoes: ${combs.join("; ")}`);
    } else if (tipo === "relacionar") {
      const opcoes = q.opcoes.map((s) => String(s).trim()).filter(Boolean);
      lines.push(`opcoes: ${opcoes.join("; ")}`);
      const dirs = (q.coluna_direita || []).map((s) => String(s).trim()).filter(Boolean);
      lines.push(`coluna_direita: ${dirs.join("; ")}`);
      const combs = (q.combinacoes || [])
        .map((s) => String(s).trim())
        .filter(Boolean);
      lines.push(`combinacoes: ${combs.join("; ")}`);
    } else {
      const opcoes = q.opcoes.map((s) => String(s).trim()).filter(Boolean);
      lines.push(`opcoes: ${opcoes.join("; ")}`);
    }
    if (tipo !== "discursiva") {
      const respostaRaw = String(q.resposta || "");
      if (respostaRaw.trim()) {
        const respostaLines = respostaRaw.split(/\r?\n/);
        lines.push(`resposta: ${respostaLines[0]}`);
        for (let r = 1; r < respostaLines.length; r++) {
          lines.push(respostaLines[r]);
        }
      }
    }
    lines.push(`eh_opcional: ${q.eh_opcional ? "sim" : "nao"}`);
    if (q.encadeia_com_stable_key) {
      const ji = state.questions.findIndex((x) => x.stableKey === q.encadeia_com_stable_key);
      if (ji >= 0) {
        lines.push(`encadeia_com: Q${ji + 1}`);
      }
    }
    lines.push(`apenas_renderizar_sozinha: ${q.apenas_renderizar_sozinha ? "sim" : "nao"}`);
    const pesoRaw = q.peso == null ? "" : String(q.peso).trim();
    if (pesoRaw !== "") {
      const p = parsePeso(pesoRaw);
      lines.push(`peso: ${String(p).replace(",", ".")}`);
    }
    return lines.join("\n");
  }

  function metaHasContent() {
    return META_KEYS.some((k) => normalizeMetaValue(state.meta[k] || "") !== "");
  }

  function serializeMetaBlock() {
    const parts = ["# meta"];
    for (const key of META_KEYS) {
      const v = normalizeMetaValue(state.meta[key] || "");
      if (v) {
        parts.push(`${key}: ${v}`);
      }
    }
    return parts.join("\n");
  }

  function serializeMd() {
    const chunks = [];
    if (state.includeMeta && metaHasContent()) {
      chunks.push(serializeMetaBlock());
    }
    state.questions.forEach((q, i) => {
      chunks.push(serializeQuestionBlock(q, i));
    });
    return chunks.join("\n\n") + "\n";
  }

  function showValidationErrors(errors, options) {
    const el = document.getElementById("validationAlert");
    if (!el) {
      return;
    }
    if (!errors.length) {
      el.classList.add("d-none");
      el.textContent = "";
      return;
    }
    const opts = options || {};
    const title = opts.title || "Corrija antes de exportar:";
    el.classList.remove("d-none");
    el.innerHTML =
      `<strong>${escapeHtml(title)}</strong><ul class="mb-0 mt-2">` +
      errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("") +
      "</ul>";
    if (opts.scroll !== false) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function render() {
    const root = document.getElementById("questionsRoot");
    const cta = renderGerarProvaCtaHtml();
    const html = state.questions.map((q, i) => renderQuestionCard(q, i)).join("");
    root.innerHTML = cta + html;
    document.getElementById("includeMeta").checked = state.includeMeta;
    for (const key of META_KEYS) {
      const el = document.querySelector(`[data-meta-key="${key}"]`);
      if (el) el.value = state.meta[key] || "";
    }
    applyMetaInputPlaceholders();
    document.getElementById("outFilename").value = state.filename;
    updateProvaTabBadge();
  }

  const SVG_RESPOSTA_THUMB =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="btn-resposta-opt-svg" fill="currentColor" aria-hidden="true"><path d="M720-120H320v-520l280-280 50 50q7 7 11.5 19t4.5 23v14l-44 174h218q32 0 56 24t24 56v80q0 7-1.5 15t-4.5 15L794-168q-9 20-30 34t-44 14ZM240-640v520H80v-520h160Z"/></svg>';
  const SVG_RESPOSTA_CLOSE =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" class="btn-resposta-opt-svg" fill="currentColor" aria-hidden="true"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';

  function respostaCorretaLinhaButton(kind, i, letter, selVal) {
    const dataAttr = kind === "mc" ? "data-resposta-mc" : "data-resposta-vf";
    let cls = "btn btn-sm btn-resposta-opt btn-outline-light border-secondary";
    let iconSvg = SVG_RESPOSTA_THUMB;
    let pressed = "false";
    if (selVal) {
      if (selVal === letter) {
        cls = "btn btn-sm btn-resposta-opt btn-outline-success";
        iconSvg = SVG_RESPOSTA_THUMB;
        pressed = "true";
      } else {
        cls = "btn btn-sm btn-resposta-opt btn-outline-danger";
        iconSvg = SVG_RESPOSTA_CLOSE;
      }
    }
    return (
      `<button type="button" class="${cls}" ${dataAttr} data-q="${i}" data-letter="${letter}" ` +
      `title="Resposta correta: ${letter}" aria-label="Marcar ${letter} como resposta correta" aria-pressed="${pressed}">` +
      iconSvg +
      `</button>`
    );
  }

  function bytesToDataUrlForImg(bytes, ext) {
    const mime =
      ext === "png"
        ? "image/png"
        : ext === "jpg"
          ? "image/jpeg"
          : ext === "gif"
            ? "image/gif"
            : ext === "webp"
              ? "image/webp"
              : "application/octet-stream";
    let bin = "";
    const step = 0x8000;
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let j = 0; j < u8.length; j += step) {
      bin += String.fromCharCode.apply(null, u8.subarray(j, j + step));
    }
    return `data:${mime};base64,${btoa(bin)}`;
  }

  function getBootstrapModalFoto() {
    const el = document.getElementById("fotoEnunciadoModal");
    const B = globalThis.bootstrap;
    if (!el || !B || !B.Modal) {
      return null;
    }
    if (!fotoModalInstance) {
      fotoModalInstance = new B.Modal(el);
    }
    return fotoModalInstance;
  }

  function openFotoEnunciadoModal(i) {
    const qq = state.questions[i];
    const img = document.getElementById("fotoEnunciadoModalImg");
    const sem = document.getElementById("fotoEnunciadoModalSemPreview");
    fotoModalQuestionIndex = i;
    const hasBytes =
      qq &&
      qq.foto_enunciado_bytes &&
      qq.foto_enunciado_bytes.byteLength &&
      qq.foto_enunciado_ext;
    if (hasBytes && img && sem) {
      img.src = bytesToDataUrlForImg(qq.foto_enunciado_bytes, qq.foto_enunciado_ext);
      img.classList.remove("d-none");
      sem.classList.add("d-none");
    } else if (img && sem) {
      img.removeAttribute("src");
      img.classList.add("d-none");
      sem.classList.remove("d-none");
    }
    getBootstrapModalFoto()?.show();
  }

  function renderQuestionCard(q, i) {
    const tipo = q.tipo || "multipla-escolha";
    const isDisc = tipo === "discursiva";
    const isVf = tipo === "verdadeiro_falso";
    const isRel = tipo === "relacionar";
    const isMc = tipo === "multipla-escolha";
    const opcoesRawLen = Array.isArray(q.opcoes) ? q.opcoes.length : 0;
    const combsRawLen = Array.isArray(q.combinacoes) ? q.combinacoes.length : 0;
    const opcoes = opcaoesParaRender(q);
    const combs = combinacoesParaRender(q);
    const colDirs = colDirParaRender(q);
    const canRemoveOpcao = opcoesRawLen > 2;
    const canRemoveComb = combsRawLen > 2;
    const rowBadge = (j) => (isRel ? romanRowLabel(j) : letterLabel(j));
    const selVal = isMc ? normalizeMcRespostaLetter(q.resposta, opcoes.length) : "";
    const vfSelVal = isVf || isRel ? normalizeMcRespostaLetter(q.resposta, combs.length) : "";
    const melhorarOpcao = !isMc;
    const optsHtml = opcoes
      .map((op, j) => {
        const L = letterLabel(j);
        const btnMc = isMc ? respostaCorretaLinhaButton("mc", i, L, selVal) : "";
        const btnMelhorar = melhorarOpcao ? aiMelhorarCampoBtn(i, "opcao", j) : "";
        const phOpcao = isRel
          ? "Ex.: RF (aparece após " + romanRowLabel(j) + ". no PDF)"
          : isVf
            ? "Texto da afirmação " + (j + 1)
            : "Texto da alternativa " + L;
        return `<div class="input-group input-group-sm mb-2 option-row">
            <span class="input-group-text bg-dark text-light border-secondary">${rowBadge(j)}</span>
            <input type="text" class="form-control" data-field="opcao" value="${escapeAttr(op)}" data-q="${i}" data-opt="${j}" spellcheck="true" lang="pt-BR" placeholder="${escapeAttr(phOpcao)}">
            ${btnMelhorar}
            ${btnMc}
            <button type="button" class="btn btn-outline-secondary btn-sm" data-action="remove-option" data-q="${i}" data-opt="${j}" ${canRemoveOpcao ? "" : "disabled"}>−</button>
          </div>`;
      })
      .join("");
    const dirOptsHtml = colDirs
      .map(
        (op, j) =>
          `<div class="input-group input-group-sm mb-2 option-row">
            <span class="input-group-text bg-dark text-light border-secondary">${rowBadge(j)}</span>
            <input type="text" class="form-control" data-field="col_dir" value="${escapeAttr(op)}" data-q="${i}" data-opt="${j}" spellcheck="true" lang="pt-BR" placeholder="Linha ${rowBadge(j)} (à direita do parêntesis)">
            ${aiMelhorarCampoBtn(i, "col_dir", j)}
            <button type="button" class="btn btn-outline-secondary btn-sm" disabled tabindex="-1" aria-hidden="true" style="min-width:2rem"> </button>
          </div>`
      )
      .join("");
    const combPh = isVf ? "Ex.: V, V, F e F" : isRel ? "Ex.: I, IV, III, II" : "Ex.: V, V, F e F";
    const combRomanBadge = (j) => {
      if (!isRel) {
        return letterLabel(j);
      }
      const idx = opcoesRawLen + j;
      return romanRowLabel(idx);
    };
    const combsHtml = combs
      .map((op, j) => {
        const L = letterLabel(j);
        const btnVf = isVf || isRel ? respostaCorretaLinhaButton("vf", i, L, vfSelVal) : "";
        return `<div class="input-group input-group-sm mb-2 option-row">
            <span class="input-group-text bg-dark text-light border-secondary">${combRomanBadge(j)}</span>
            <input type="text" class="form-control" data-field="combinacao" value="${escapeAttr(op)}" data-q="${i}" data-opt="${j}" spellcheck="true" lang="pt-BR" placeholder="${escapeAttr(combPh)}">
            ${btnVf}
            <button type="button" class="btn btn-outline-secondary btn-sm" data-action="remove-comb" data-q="${i}" data-opt="${j}" ${canRemoveComb ? "" : "disabled"}>−</button>
          </div>`;
      })
      .join("");
    const opcoesLabel = isVf ? "Afirmações" : "Alternativas";
    const combRowsLabel = isRel ? "Alternativas de correção (rótulo romano; no PDF: a, b, c…)" : "Alternativas de resposta";
    const hasFotoInMemory = !!(
      q.foto_enunciado_bytes &&
      q.foto_enunciado_bytes.byteLength &&
      q.foto_enunciado_ext
    );
    const hasFotoRef = !!(q.foto_enunciado_basename_md && String(q.foto_enunciado_basename_md).trim());
    const hasFotoUi = hasFotoInMemory || hasFotoRef;
    const fotoBtnClass = hasFotoUi
      ? "btn btn-link pergunta-foto-trigger pergunta-foto-trigger--has p-1 border-0 shadow-none text-decoration-none"
      : "btn btn-link pergunta-foto-trigger p-1 border-0 shadow-none text-decoration-none";
    const fotoBtnAria = hasFotoUi ? "Ver ou alterar imagem do enunciado" : "Anexar imagem ao enunciado";
    const encadeadaPor = listEncadeadaPorIds(state.questions, i);
    const encPorLabelHtml =
      encadeadaPor.length > 0
        ? `<span class="small text-pr-muted me-2 align-self-center">Encadeada por: ${escapeHtml(encadeadaPor.join(", "))}</span>`
        : "";
    const encLocked = questionEncadeioLocked(state.questions, i);
    const encSelVal = q.encadeia_com_stable_key || "";
    const encOptsHtml = state.questions
      .map((oq, j) => {
        if (j === i) return "";
        const sn = truncatePlaceholder(oq.pergunta || "", 42);
        const sel = oq.stableKey === q.encadeia_com_stable_key ? " selected" : "";
        return `<option value="${escapeAttr(oq.stableKey)}"${sel}>Q${j + 1}: ${escapeHtml(sn)}</option>`;
      })
      .join("");
    const hiddenRespostas =
      (isMc ? `<input type="hidden" id="resposta_mc_${i}" data-field="resposta_mc" value="${escapeAttr(selVal)}">` : "") +
      (isVf || isRel ? `<input type="hidden" id="resposta_vf_${i}" data-field="resposta_vf" value="${escapeAttr(vfSelVal)}">` : "");
    const gerarOpcoesHidden = isDisc || !aiOnline ? " d-none" : "";
    return `
<div class="card mb-3 question-card" data-question-index="${i}" data-stable-key="${escapeAttr(q.stableKey || "")}">
  <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
    <span class="align-self-center">Questão ${i + 1}</span>
    <div class="d-flex flex-wrap align-items-center gap-2 ms-md-auto">
      ${encPorLabelHtml}
      <div class="btn-group btn-group-sm" role="group" aria-label="Reordenar ou remover questão">
        <button type="button" class="btn btn-outline-light btn-question-ico" data-action="move-up" data-q="${i}" ${i === 0 ? "disabled" : ""} title="Subir" aria-label="Subir questão">
          <img src="assets/icon/arrow_drop_up.svg" class="question-header-ico" width="22" height="22" alt="">
        </button>
        <button type="button" class="btn btn-outline-light btn-question-ico" data-action="move-down" data-q="${i}" ${i === state.questions.length - 1 ? "disabled" : ""} title="Descer" aria-label="Descer questão">
          <img src="assets/icon/arrow_drop_down.svg" class="question-header-ico" width="22" height="22" alt="">
        </button>
        <button type="button" class="btn btn-outline-danger btn-question-ico" data-action="remove-q" data-q="${i}" ${state.questions.length <= 1 ? "disabled" : ""} title="Remover" aria-label="Remover questão">
          <img src="assets/icon/close.svg" class="question-header-ico" width="20" height="20" alt="">
        </button>
      </div>
    </div>
  </div>
  <div class="card-body">
    <label class="form-label" for="pergunta_${i}">Enunciado</label>
    <div class="position-relative pergunta-enunciado-wrap mb-3">
      <textarea class="form-control pergunta-enunciado-textarea" id="pergunta_${i}" rows="4" data-field="pergunta" spellcheck="true" lang="pt-BR" placeholder="Texto da questão para o aluno">${escapeHtml(q.pergunta || "")}</textarea>
      <input type="file" class="d-none" id="foto_enunciado_file_${i}" accept="image/png,image/jpeg,image/webp,image/gif" data-field="foto_enunciado_file" data-q="${i}">
      <div class="pergunta-enunciado-ai-ui">
        <button type="button" class="${fotoBtnClass}" data-action="pick-foto-enunciado" data-q="${i}" title="Anexar imagem ao enunciado (PDF)" aria-label="${escapeAttr(fotoBtnAria)}">
          <img src="assets/icon/photo.svg" class="pergunta-foto-ico" width="20" height="20" alt="">
        </button>
        ${aiMelhorarCampoBtn(i, "pergunta", null, "btn-ai-campo-enunciado")}
      </div>
    </div>
    <div class="row g-3 mb-3">
      <div class="col-md-4">
        <label class="form-label" for="tipo_${i}">Tipo</label>
        <select class="form-select" id="tipo_${i}" data-field="tipo">
          <option value="multipla-escolha" ${tipo === "multipla-escolha" ? "selected" : ""}>Múltipla escolha</option>
          <option value="discursiva" ${tipo === "discursiva" ? "selected" : ""}>Discursiva</option>
          <option value="verdadeiro_falso" ${tipo === "verdadeiro_falso" ? "selected" : ""}>Verdadeiro / falso</option>
          <option value="relacionar" ${tipo === "relacionar" ? "selected" : ""}>Relacionar (duas colunas)</option>
        </select>
      </div>
      <div class="col-md-4 ${isDisc ? "" : "d-none"}" data-panel="linhas">
        <label class="form-label" for="linhas_${i}">Linhas</label>
        <input type="number" class="form-control" id="linhas_${i}" data-field="linhas" min="1" value="${escapeAttr(String(q.linhas || 3))}" placeholder="Linhas em branco">
      </div>
      <div class="col-md-4">
        <label class="form-label" for="peso_${i}">Peso</label>
        <div class="d-flex gap-2 align-items-stretch">
          <input type="text" class="form-control flex-grow-1" id="peso_${i}" data-field="peso" value="${escapeAttr(q.peso != null ? String(q.peso) : "")}" placeholder="Opcional, 0 a 10">
          <button type="button" class="btn btn-sm btn-outline-light btn-ai-gerar flex-shrink-0${gerarOpcoesHidden}" data-action="ai-gerar-opcoes" data-q="${i}">Gerar opções</button>
        </div>
      </div>
    </div>
    <div class="mb-3 ${isDisc ? "d-none" : ""}" data-panel="opcoes">
      ${
        isRel
          ? `<div class="row g-2 align-items-start">
      <div class="col-md-6">
        <label class="form-label">Coluna esquerda (I, II, … no PDF)</label>
        ${optsHtml}
      </div>
      <div class="col-md-6" data-panel="col-dir">
        <label class="form-label">Coluna direita</label>
        ${dirOptsHtml}
      </div>
    </div>`
          : `<label class="form-label">${opcoesLabel}</label>
      ${optsHtml}`
      }
      <button type="button" class="btn btn-sm btn-outline-light" data-action="add-option" data-q="${i}">Adicionar alternativa</button>
    </div>
    <div class="mb-3 ${isVf || isRel ? "" : "d-none"}" data-panel="combinacoes">
      <label class="form-label">${combRowsLabel}</label>
      ${combsHtml}
      <button type="button" class="btn btn-sm btn-outline-light" data-action="add-comb" data-q="${i}">Adicionar alternativa de resposta</button>
    </div>
    <div class="mb-3 encadeio-toolbar d-flex flex-wrap align-items-center gap-2 w-100">
      <div class="d-flex flex-wrap align-items-center gap-2 flex-grow-1 justify-content-between">
        <label class="small text-pr-muted mb-0 d-flex align-items-center gap-1 text-nowrap">
          <img src="assets/icon/link.svg" width="18" height="18" class="question-header-ico" alt="" aria-hidden="true">
          Condicional a outra pergunta
        </label>
        <div class="d-flex flex-wrap align-items-center gap-2 flex-grow-1 justify-content-md-end" style="min-width: 200px; max-width: 100%;">
          <input type="search" class="form-control form-control-sm encadeio-filter flex-shrink-0" style="max-width: 9rem" data-role="encadeia-filter" data-q="${i}" placeholder="Filtrar" aria-label="Filtrar lista de questões para encadear" value="">
          <select class="form-select form-select-sm" style="min-width: 12rem; max-width: 22rem" id="encadeia_sel_${i}" data-field="encadeia_com_stable_key" data-q="${i}" aria-label="Selecionar questão encadeada">
            <option value="" ${!encSelVal ? "selected" : ""}>(nenhuma)</option>
            ${encOptsHtml}
          </select>
        </div>
      </div>
    </div>
    <div class="d-flex flex-wrap gap-3">
      <div class="form-check mb-0">
        <input class="form-check-input" type="checkbox" id="opt_${i}" data-field="eh_opcional" ${q.eh_opcional && !encLocked ? "checked" : ""} ${encLocked ? "disabled" : ""}>
        <label class="form-check-label" for="opt_${i}">Questão opcional</label>
      </div>
      <div class="form-check mb-0">
        <input class="form-check-input" type="checkbox" id="opt_sozinha_${i}" data-field="apenas_renderizar_sozinha" ${q.apenas_renderizar_sozinha ? "checked" : ""}>
        <label class="form-check-label" for="opt_sozinha_${i}">Apenas renderizar sozinha</label>
      </div>
    </div>
    ${hiddenRespostas ? `<div class="visually-hidden">${hiddenRespostas}</div>` : ""}
  </div>
</div>`;
  }

  function syncPanels(card) {
    const tipo = card.querySelector('[data-field="tipo"]').value;
    const isDisc = tipo === "discursiva";
    const isVf = tipo === "verdadeiro_falso";
    const isRel = tipo === "relacionar";
    const linhasPanel = card.querySelector('[data-panel="linhas"]');
    const opcoesPanel = card.querySelector('[data-panel="opcoes"]');
    const colDirPanel = card.querySelector('[data-panel="col-dir"]');
    const combPanel = card.querySelector('[data-panel="combinacoes"]');
    if (linhasPanel) linhasPanel.classList.toggle("d-none", !isDisc);
    if (opcoesPanel) opcoesPanel.classList.toggle("d-none", isDisc);
    if (colDirPanel) colDirPanel.classList.toggle("d-none", !isRel);
    if (combPanel) combPanel.classList.toggle("d-none", !isVf && !isRel);
    const gerarBtn = card.querySelector('[data-action="ai-gerar-opcoes"]');
    if (gerarBtn) {
      gerarBtn.classList.toggle("d-none", isDisc || !aiOnline);
    }
  }

  document.getElementById("questionsRoot").addEventListener("change", (e) => {
    const fIn = e.target.closest('[data-field="foto_enunciado_file"]');
    if (fIn && fIn.matches('input[type="file"]')) {
      const file = fIn.files && fIn.files[0];
      const i = parseInt(fIn.getAttribute("data-q"), 10);
      readMetaFromDom();
      readQuestionsFromDom();
      if (file && state.questions[i]) {
        const ext = extFromMimeOrFile(file.type, file.name);
        file
          .arrayBuffer()
          .then((buf) => {
            state.questions[i].foto_enunciado_bytes = new Uint8Array(buf);
            state.questions[i].foto_enunciado_ext = ext;
            state.questions[i].foto_enunciado_basename_md = null;
            fIn.value = "";
            render();
            document.querySelectorAll(".question-card").forEach(syncPanels);
          })
          .catch(() => {
            fIn.value = "";
          });
      } else {
        fIn.value = "";
      }
      return;
    }
    const encSelPick = e.target.closest('[data-field="encadeia_com_stable_key"]');
    if (encSelPick && encSelPick.matches("select")) {
      readMetaFromDom();
      readQuestionsFromDom();
      render();
      document.querySelectorAll(".question-card").forEach(syncPanels);
      return;
    }
    const tipoEl = e.target.closest('[data-field="tipo"]');
    if (tipoEl) {
      readMetaFromDom();
      readQuestionsFromDom();
      render();
      document.querySelectorAll(".question-card").forEach(syncPanels);
      return;
    }
  });

  document.getElementById("questionsRoot").addEventListener("input", (e) => {
    const encFilt = e.target.closest('[data-role="encadeia-filter"]');
    if (!encFilt) {
      return;
    }
    const card = encFilt.closest(".question-card");
    const sel = card && card.querySelector('[data-field="encadeia_com_stable_key"]');
    const t = String(encFilt.value || "").trim().toLowerCase();
    if (sel) {
      sel.querySelectorAll("option").forEach((op) => {
        if (!op.value) {
          op.hidden = false;
          return;
        }
        op.hidden = t.length > 0 && !String(op.textContent || "").toLowerCase().includes(t);
      });
    }
  });

  document.getElementById("questionsRoot").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const i = parseInt(btn.getAttribute("data-q"), 10);
    const action = btn.getAttribute("data-action");
    if (action === "ai-melhorar-campo") {
      const gpb = globalThis.editorChatGpb;
      if (!gpb || !aiOnline) return;
      const card = btn.closest(".question-card");
      runAiMelhorarCampo(btn, card, i);
      return;
    }
    if (action === "ai-gerar-opcoes") {
      const gpb = globalThis.editorChatGpb;
      if (!gpb || !aiOnline) return;
      const card = btn.closest(".question-card");
      runAiAction(btn, card, i, (pergunta) => {
        const q = state.questions[i];
        const tipo = normalizeTipo(q && q.tipo);
        if (tipo === "multipla-escolha") return gpb.gerarOpcoesMc(pergunta);
        if (tipo === "verdadeiro_falso") return gpb.gerarOpcoesVf(pergunta, q);
        if (tipo === "relacionar") return gpb.gerarOpcoesRelacionar(pergunta);
        return Promise.reject(new Error("Tipo de questão não suportado para gerar opções."));
      });
      return;
    }
    if (action === "pick-foto-enunciado") {
      readMetaFromDom();
      readQuestionsFromDom();
      const qq = state.questions[i];
      const hasFotoInMemory = !!(
        qq &&
        qq.foto_enunciado_bytes &&
        qq.foto_enunciado_bytes.byteLength &&
        qq.foto_enunciado_ext
      );
      const hasFotoRef = !!(
        qq && qq.foto_enunciado_basename_md && String(qq.foto_enunciado_basename_md).trim()
      );
      if (hasFotoInMemory || hasFotoRef) {
        openFotoEnunciadoModal(i);
      } else {
        const inp = document.getElementById(`foto_enunciado_file_${i}`);
        if (inp) {
          inp.click();
        }
      }
      return;
    }
    readMetaFromDom();
    readQuestionsFromDom();
    if (action === "move-up" && i > 0) {
      const t = state.questions[i - 1];
      state.questions[i - 1] = state.questions[i];
      state.questions[i] = t;
      render();
      return;
    }
    if (action === "move-down" && i < state.questions.length - 1) {
      const t = state.questions[i + 1];
      state.questions[i + 1] = state.questions[i];
      state.questions[i] = t;
      render();
      return;
    }
    if (action === "remove-q" && state.questions.length > 1) {
      const removedSk = state.questions[i].stableKey;
      state.questions.splice(i, 1);
      clearEncadeiaReferringTo(state.questions, removedSk);
      render();
      return;
    }
    if (action === "add-option") {
      const q = state.questions[i];
      if (!Array.isArray(q.opcoes)) q.opcoes = blankOpcoes(DEFAULT_MC_OPCOES);
      q.opcoes.push("");
      if (normalizeTipo(q.tipo) === "relacionar") {
        if (!Array.isArray(q.coluna_direita)) q.coluna_direita = blankOpcoes(DEFAULT_MC_OPCOES);
        q.coluna_direita.push("");
      }
      render();
      return;
    }
    if (action === "remove-option") {
      const j = parseInt(btn.getAttribute("data-opt"), 10);
      const q = state.questions[i];
      if (q.opcoes && q.opcoes.length > 2) {
        q.opcoes.splice(j, 1);
        if (normalizeTipo(q.tipo) === "relacionar" && Array.isArray(q.coluna_direita) && q.coluna_direita.length > j) {
          q.coluna_direita.splice(j, 1);
        }
        render();
      }
      return;
    }
    if (action === "add-comb") {
      const q = state.questions[i];
      if (!Array.isArray(q.combinacoes)) q.combinacoes = blankOpcoes(DEFAULT_VF_COMBINACOES);
      q.combinacoes.push("");
      render();
      return;
    }
    if (action === "remove-comb") {
      const j = parseInt(btn.getAttribute("data-opt"), 10);
      const q = state.questions[i];
      if (q.combinacoes && q.combinacoes.length > 2) {
        q.combinacoes.splice(j, 1);
        render();
      }
      return;
    }
  });

  document.getElementById("btnAddQuestion").addEventListener("click", () => {
    readMetaFromDom();
    readQuestionsFromDom();
    state.questions.push(createEmptyQuestion());
    render();
  });

  document.getElementById("includeMeta").addEventListener("change", () => {
    state.includeMeta = document.getElementById("includeMeta").checked;
  });

  function ensurePrFilename(name) {
    let n = String(name || "").trim().replace(/[/\\?%*:|"<>]/g, "_") || "fonte.pr";
    if (!/\.pr$/i.test(n)) {
      n = n.replace(/\.(md|markdown|txt)$/i, "") + ".pr";
    }
    return n;
  }

  document.getElementById("btnDownload").addEventListener("click", async () => {
    const errors = validateAll();
    showValidationErrors(errors);
    if (errors.length) return;
    if (typeof JSZip === "undefined") {
      showValidationErrors(["JSZip não carregou. Recarregue a página."]);
      return;
    }
    const btnDownload = document.getElementById("btnDownload");
    setButtonLoading(btnDownload, true, { idleText: "Exportar", loadingText: "Exportando…" });
    try {
    const blob = await buildPrBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ensurePrFilename(document.getElementById("outFilename").value || state.filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    } finally {
      setButtonLoading(btnDownload, false, { idleText: "Exportar" });
    }
  });

  function fabScrollPage(direction) {
    const delta = direction < 0 ? -window.innerHeight : window.innerHeight;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.scrollBy({ top: delta, left: 0, behavior });
  }

  document.getElementById("fabPageUp")?.addEventListener("click", () => fabScrollPage(-1));
  document.getElementById("fabPageDown")?.addEventListener("click", () => fabScrollPage(1));

  META_KEYS.forEach((key) => {
    const el = document.querySelector(`[data-meta-key="${key}"]`);
    if (el) {
      el.addEventListener("input", () => {
        state.meta[key] = el.value;
        persistMetaToSession();
        applyMetaInputPlaceholders();
      });
    }
  });

  document.getElementById("outFilename").addEventListener("input", (e) => {
    state.filename = e.target.value;
  });

  function applyImportedMarkdown(text, fileName, fillMeta, correcaoPayload) {
    const { meta, questions: parsedRows } = parseMarkdownPrImport(text);
    if (fillMeta && meta && typeof meta === "object") {
      for (const key of META_KEYS) {
        if (Object.prototype.hasOwnProperty.call(meta, key)) {
          state.meta[key] = meta[key];
        }
      }
      const hasAny = META_KEYS.some(
        (k) => meta[k] != null && String(meta[k]).trim() !== ""
      );
      if (hasAny) {
        state.includeMeta = true;
        const inc = document.getElementById("includeMeta");
        if (inc) {
          inc.checked = true;
        }
      }
    }
    state.questions = parsedRows.map((p, i) => questionFromPrParsed(p, i));
    resolveEncadeiaStableKeysFromImport(state.questions, parsedRows);
    applyEncadeamentoOpcionalRules(state.questions);
    if (correcaoPayload && typeof correcaoPayload === "object" && correcaoPayload.byRef) {
      state.correcaoEmbedded = {
        version: correcaoPayload.version || 1,
        sourcePath: correcaoPayload.sourcePath,
        generatedAt: correcaoPayload.generatedAt,
        byRef: { ...correcaoPayload.byRef },
        lastRun:
          correcaoPayload.lastRun &&
          typeof correcaoPayload.lastRun === "object" &&
          typeof correcaoPayload.lastRun.count === "number"
            ? {
                count: correcaoPayload.lastRun.count,
                generatedAt: correcaoPayload.lastRun.generatedAt
              }
            : null
      };
    } else {
      state.correcaoEmbedded = null;
    }
    const safeName = (fileName || "fonte.pr").replace(/[/\\?%*:|"<>]/g, "_");
    state.filename = ensurePrFilename(safeName);
    const fnEl = document.getElementById("outFilename");
    if (fnEl) {
      fnEl.value = state.filename;
    }
    refreshCorrecaoMapFromState();
    persistMetaToSession();
    showValidationErrors([]);
    render();
    document.querySelectorAll(".question-card").forEach(syncPanels);
  }

  document.getElementById("importPrFile").addEventListener("change", (e) => {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) {
      return;
    }
    const fillMeta = document.getElementById("importFillMeta").checked;
    const reader = new FileReader();
    reader.onerror = () => {
      showValidationErrors(["Não foi possível ler o arquivo."]);
      input.value = "";
    };
    reader.onload = async () => {
      try {
        await importPrFromArrayBuffer(reader.result, file.name, fillMeta);
      } catch (err) {
        showValidationErrors([String(err && err.message ? err.message : err)]);
      }
      input.value = "";
    };
    reader.readAsArrayBuffer(file);
  });

  function showCorrigirAlert(msg) {
    const el = document.getElementById("corrigirAlert");
    const res = document.getElementById("corrigirResult");
    res.classList.add("d-none");
    res.innerHTML = "";
    el.textContent = msg;
    el.classList.remove("d-none");
  }

  function clearCorrigirAlert() {
    const el = document.getElementById("corrigirAlert");
    el.classList.add("d-none");
    el.textContent = "";
  }

  function respostaCorrigirTexto(q) {
    if (q.tipo === "discursiva") {
      return "\u2014";
    }
    const r =
      q.resposta != null && String(q.resposta).trim() !== "" ? String(q.resposta).trim() : "";
    if (!r) {
      return "(não indicada)";
    }
    return r.toUpperCase();
  }

  function normalizeProvaRefEditor(ref) {
    if (ref == null) {
      return "";
    }
    return String(ref)
      .trim()
      .toLowerCase()
      .replace(/[^23456789abcdefghjkmnpqrstvwxyz]/g, "");
  }

  function formatProvaRefDisplayEditor(refNorm) {
    if (!refNorm) {
      return "";
    }
    const parts = [];
    for (let i = 0; i < refNorm.length; i += 3) {
      parts.push(refNorm.slice(i, i + 3));
    }
    return parts.join("-");
  }

  function formatPrDisplayName(filename) {
    const base = String(filename || "")
      .replace(/\.pr$/i, "")
      .trim();
    return base
      .replace(/[-_]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  }

  function updateCorrigirTabBadge(count) {
    const badge = document.getElementById("corrigirTabBadge");
    if (!badge) {
      return;
    }
    const n = Math.max(0, count || 0);
    if (n <= 0) {
      badge.classList.add("d-none");
      badge.textContent = "0";
    } else {
      badge.classList.remove("d-none");
      badge.textContent = String(n);
    }
  }

  function showPrImportPanels(loaded, displayName) {
    state.prLoaded = !!loaded;
    if (loaded && displayName) {
      state.prDisplayName = displayName;
    } else if (!loaded) {
      state.prDisplayName = "";
    }
    const upload = document.getElementById("importPrCard");
    const loadedCard = document.getElementById("importPrLoadedCard");
    const nameEl = document.getElementById("importPrLoadedName");
    if (upload) {
      upload.classList.toggle("d-none", !!loaded);
    }
    if (loadedCard) {
      loadedCard.classList.toggle("d-none", !loaded);
    }
    if (nameEl && displayName) {
      nameEl.textContent = displayName;
    }
    render();
  }

  function clearPrLoadedState() {
    state.includeMeta = true;
    state.meta = Object.fromEntries(META_KEYS.map((k) => [k, ""]));
    state.metaSnapshot = {};
    state.questions = [createEmptyQuestion()];
    state.filename = "fonte.pr";
    state.correcaoEmbedded = null;
    state.fontes = [];
    setGeneratedPdf(null);
    correcaoPorRefByNorm = null;
    const inc = document.getElementById("includeMeta");
    if (inc) {
      inc.checked = true;
    }
    const fnEl = document.getElementById("outFilename");
    if (fnEl) {
      fnEl.value = "fonte.pr";
    }
    const importInput = document.getElementById("importPrFile");
    if (importInput) {
      importInput.value = "";
    }
    showPrImportPanels(false);
    updateCorrigirTabBadge(0);
    updateFontesBadges();
    renderFontesPane();
    renderGerarQuestaoFontesList();
    renderAiFontesChecklist("gerarProva");
    persistMetaToSession();
    showValidationErrors([]);
    clearCorrigirAlert();
    const resEl = document.getElementById("corrigirResult");
    if (resEl) {
      resEl.classList.add("d-none");
      resEl.innerHTML = "";
    }
    render();
    document.querySelectorAll(".question-card").forEach(syncPanels);
  }

  function refreshCorrecaoMapFromState() {
    correcaoPorRefByNorm = null;
    const br = state.correcaoEmbedded && state.correcaoEmbedded.byRef;
    if (!br || typeof br !== "object") {
      updateCorrigirTabBadge(0);
      return;
    }
    const m = {};
    for (const [k, v] of Object.entries(br)) {
      const nk = normalizeProvaRefEditor(k);
      if (!nk || !v || typeof v !== "object") {
        continue;
      }
      const h = v.hash != null ? String(v.hash).trim().toLowerCase() : "";
      const s = v.seed != null ? String(v.seed).trim() : "";
      if (/^[0-9a-f]{12}$/.test(h) && s) {
        m[nk] = { hash: h, seed: s };
      }
    }
    if (Object.keys(m).length > 0) {
      correcaoPorRefByNorm = m;
    }
    updateCorrigirTabBadge(correcaoPorRefByNorm ? Object.keys(correcaoPorRefByNorm).length : 0);
  }

  function buildCorrigirGabaritoBloco(plan) {
    const objetivas = [];
    const discursivas = [];
    plan.orderedQuestions.forEach((q, i) => {
      const num = i + 1;
      if (q.tipo === "discursiva") {
        discursivas.push({
          num,
          pergunta: q.pergunta != null ? String(q.pergunta).trim() : ""
        });
      } else {
        objetivas.push({ num, resp: respostaCorrigirTexto(q) });
      }
    });

    const cols = 5;
    const rowsObj = [];
    for (let r = 0; r < objetivas.length; r += cols) {
      const tds = [];
      for (let c = 0; c < cols; c += 1) {
        const idx = r + c;
        if (idx < objetivas.length) {
          const { num, resp } = objetivas[idx];
          tds.push(
            "<td class=\"corrigir-gab-cel font-monospace\"><span class=\"text-pr-muted\">" +
              num +
              ".</span> " +
              escapeHtml(resp) +
              "</td>"
          );
        } else {
          tds.push("<td class=\"corrigir-gab-cel corrigir-gab-cel-empty\"></td>");
        }
      }
      rowsObj.push("<tr>" + tds.join("") + "</tr>");
    }

    const tableObj =
      objetivas.length > 0
        ? "<table class=\"table table-sm table-bordered table-dark table-corrigir-gab mb-0\"><tbody>" +
          rowsObj.join("") +
          "</tbody></table>"
        : "";

    let tableDisc = "";
    if (discursivas.length > 0) {
      const rowsDisc = discursivas
        .map(
          (d) =>
            "<tr><td class=\"text-pr-muted text-nowrap align-top\">" +
            d.num +
            "</td><td>" +
            escapeHtml(d.pergunta || "—") +
            "</td></tr>"
        )
        .join("");
      tableDisc =
        "<table class=\"table table-sm table-bordered table-dark table-corrigir-gab corrigir-gab-disc mb-0\"><thead><tr><th scope=\"col\" class=\"text-nowrap\">Nº</th><th scope=\"col\">Discursiva (correção manual)</th></tr></thead><tbody>" +
        rowsDisc +
        "</tbody></table>";
    }

    if (!tableObj && !tableDisc) {
      return "<p class=\"small text-pr-muted mb-0\">Nenhuma questão nesta prova.</p>";
    }

    const wrap = "<div class=\"corrigir-gab-mesa border rounded overflow-hidden\">" + tableObj + tableDisc + "</div>";
    return wrap;
  }

  function buildCorrigirDetalhesPlano(plan) {
    const optIds =
      plan.selectedOptionalIds && plan.selectedOptionalIds.length
        ? escapeHtml(plan.selectedOptionalIds.join(", "))
        : "(nenhuma)";
    return (
      "<details class=\"small text-pr-muted mb-0 mt-2\"><summary>Ordem e opcionais</summary><p class=\"mb-1\"><strong>Ordem dos ids:</strong> " +
      escapeHtml(plan.orderIds.join(", ")) +
      "</p><p class=\"mb-0\"><strong>Opcionais na prova:</strong> " +
      optIds +
      "</p></details>"
    );
  }

  function setImportCorrecaoStatus(kind, message) {
    const el = document.getElementById("importCorrecaoStatus");
    if (!el) {
      return;
    }
    el.className = "alert small mt-3 mb-0 d-none";
    el.textContent = "";
    if (!kind) {
      return;
    }
    el.classList.remove("d-none");
    if (kind === "ok") {
      el.classList.add("alert-success");
    } else if (kind === "warn") {
      el.classList.add("alert-warning");
    } else {
      el.classList.add("alert-info");
    }
    el.textContent = message;
  }

  function focusCorrigirTab() {
    const tabEl = document.getElementById("tab-corrigir");
    if (!tabEl) {
      return;
    }
    const B = globalThis.bootstrap;
    if (B && B.Tab) {
      B.Tab.getOrCreateInstance(tabEl).show();
    }
  }

  async function runCorrigirTodosGabaritos(opts) {
    const silentNoData = opts && opts.silentNoData;
    clearCorrigirAlert();
    const resEl = document.getElementById("corrigirResult");
    resEl.classList.add("d-none");
    resEl.innerHTML = "";

    const ep = globalThis.examPlanBrowser;
    if (!ep || typeof ep.drawExamPlan !== "function") {
      if (!silentNoData) {
        showCorrigirAlert("O ficheiro scripts/exam-plan-browser.js não carregou.");
      } else if (correcaoPorRefByNorm && Object.keys(correcaoPorRefByNorm).length > 0) {
        resEl.innerHTML =
          "<div class=\"alert alert-warning mb-0\">scripts/exam-plan-browser.js não carregou (verifique rede ou o caminho em relação a este index.html).</div>";
        resEl.classList.remove("d-none");
      }
      return { ok: false, code: "no_ep" };
    }

    readMetaFromDom();
    readQuestionsFromDom();

    if (!state.questions.length) {
      if (!silentNoData) {
        showCorrigirAlert("Não há questões. Importe um .pr ou adicione questões na aba Gerar.");
      }
      return { ok: false, code: "no_questions" };
    }

    if (!correcaoPorRefByNorm || !Object.keys(correcaoPorRefByNorm).length) {
      if (!silentNoData) {
        showCorrigirAlert("Sem correcao-por-ref.json neste .pr ou ficheiro vazio.");
      }
      return { ok: false, code: "no_correcao" };
    }

    const sortedNorms = Object.keys(correcaoPorRefByNorm).sort((a, b) => a.localeCompare(b));
    const blocks = [];

    for (const norm of sortedNorms) {
      const pair = correcaoPorRefByNorm[norm];
      const label = formatProvaRefDisplayEditor(norm);
      const anchor = "corrigir-ref-" + norm;

      let plan;
      let computed;
      let errMsg = "";
      try {
        const rng = ep.mulberry32(ep.seedStringToUint32(pair.seed));
        plan = ep.drawExamPlan(buildQuestionsForExamPlanEngine(state.questions), rng);
        computed = await ep.buildGenerationHashAsync({
          orderIds: plan.orderIds,
          selectedOptionalIds: plan.selectedOptionalIds
        });
      } catch (err) {
        errMsg = String(err && err.message ? err.message : err);
      }

      if (errMsg) {
        blocks.push(
          "<section class=\"corrigir-bloco-prova\" id=\"" +
            anchor +
            "\"><h3 class=\"corrigir-ref-head\">" +
            escapeHtml(label) +
            "</h3><div class=\"alert alert-danger py-2 small mb-0\">" +
            escapeHtml(errMsg) +
            "</div></section>"
        );
        continue;
      }

      if (computed !== pair.hash) {
        blocks.push(
          "<section class=\"corrigir-bloco-prova\" id=\"" +
            anchor +
            "\"><h3 class=\"corrigir-ref-head\">" +
            escapeHtml(label) +
            "</h3><div class=\"alert alert-danger py-2 small mb-0\">O hash não confere com a seed e o banco de questões atual (ordem ou ids Q1…).</div></section>"
        );
        continue;
      }

      const warnBlocks = (plan.warnings || [])
        .map((w) => "<div class=\"alert alert-warning py-2 small mb-2\">" + escapeHtml(w) + "</div>")
        .join("");

      blocks.push(
        "<section class=\"corrigir-bloco-prova\" id=\"" +
          anchor +
          "\"><h3 class=\"corrigir-ref-head\">" +
          escapeHtml(label) +
          "</h3>" +
          warnBlocks +
          "<div class=\"table-responsive\">" +
          buildCorrigirGabaritoBloco(plan) +
          "</div>" +
          buildCorrigirDetalhesPlano(plan) +
          "</section>"
      );
    }

    resEl.innerHTML = "<div class=\"corrigir-todos-wrap\">" + blocks.join("") + "</div>";

    resEl.classList.remove("d-none");
    return { ok: true };
  }

  document.getElementById("btnCorrigirGabarito").addEventListener("click", () => {
    runCorrigirTodosGabaritos({ silentNoData: false });
  });

  window.__editorProvaPr = {
    handleSetRespostaMc(btn) {
      readMetaFromDom();
      readQuestionsFromDom();
      const i = parseInt(btn.getAttribute("data-q"), 10);
      const letter = (btn.getAttribute("data-letter") || "").trim().toLowerCase();
      const q = state.questions[i];
      if (!q || normalizeTipo(q.tipo) !== "multipla-escolha") return;
      const n = (q.opcoes && q.opcoes.length) || 0;
      q.resposta = normalizeMcRespostaLetter(letter, n);
      render();
      document.querySelectorAll(".question-card").forEach(syncPanels);
    },
    handleSetRespostaVf(btn) {
      readMetaFromDom();
      readQuestionsFromDom();
      const i = parseInt(btn.getAttribute("data-q"), 10);
      const letter = (btn.getAttribute("data-letter") || "").trim().toLowerCase();
      const q = state.questions[i];
      const t = normalizeTipo(q.tipo);
      if (!q || (t !== "verdadeiro_falso" && t !== "relacionar")) return;
      const n = (q.combinacoes && q.combinacoes.length) || 0;
      q.resposta = normalizeMcRespostaLetter(letter, n);
      render();
      document.querySelectorAll(".question-card").forEach(syncPanels);
    }
  };

  const btnFotoSub = document.getElementById("fotoEnunciadoModalSubstituir");
  const btnFotoExc = document.getElementById("fotoEnunciadoModalExcluir");
  const elFotoModal = document.getElementById("fotoEnunciadoModal");
  if (btnFotoSub) {
    btnFotoSub.addEventListener("click", () => {
      const idx = fotoModalQuestionIndex;
      getBootstrapModalFoto()?.hide();
      if (idx == null) {
        return;
      }
      window.requestAnimationFrame(() => {
        const inp = document.getElementById(`foto_enunciado_file_${idx}`);
        if (inp) {
          inp.click();
        }
      });
    });
  }
  if (btnFotoExc) {
    btnFotoExc.addEventListener("click", () => {
      getBootstrapModalFoto()?.hide();
      readMetaFromDom();
      readQuestionsFromDom();
      const idx = fotoModalQuestionIndex;
      if (idx != null && state.questions[idx]) {
        const qx = state.questions[idx];
        qx.foto_enunciado_bytes = null;
        qx.foto_enunciado_ext = null;
        qx.foto_enunciado_basename_md = null;
      }
      fotoModalQuestionIndex = null;
      render();
      document.querySelectorAll(".question-card").forEach(syncPanels);
    });
  }
  if (elFotoModal) {
    elFotoModal.addEventListener("hidden.bs.modal", () => {
      const img = document.getElementById("fotoEnunciadoModalImg");
      if (img) {
        img.removeAttribute("src");
        img.classList.add("d-none");
      }
      const sem = document.getElementById("fotoEnunciadoModalSemPreview");
      if (sem) {
        sem.classList.add("d-none");
      }
    });
  }

  document.getElementById("addFontesFile")?.addEventListener("change", async (e) => {
    const input = e.target;
    const files = input.files ? Array.from(input.files) : [];
    input.value = "";
    if (!files.length) {
      return;
    }
    const errors = [];
    for (const file of files) {
      if (!isFonteFileAccepted(file)) {
        errors.push(`"${file.name}": use apenas .txt ou .md.`);
        continue;
      }
      if (file.size > FONTES_MAX_BYTES) {
        errors.push(`"${file.name}": máximo 20 MB.`);
        continue;
      }
      try {
        const text = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || ""));
          fr.onerror = () => reject(new Error("leitura"));
          fr.readAsText(file, "UTF-8");
        });
        const basename = uniqueFonteBasename(file.name);
        state.fontes.push({
          id: newFonteId(),
          basename,
          mime: file.type || (basename.toLowerCase().endsWith(".md") ? "text/markdown" : "text/plain"),
          size: file.size,
          text
        });
      } catch {
        errors.push(`"${file.name}": não foi possível ler.`);
      }
    }
    renderFontesPane();
    renderGerarQuestaoFontesList();
    renderAiFontesChecklist("gerarProva");
    if (errors.length) {
      showValidationErrors(errors);
    } else {
      showValidationErrors([]);
    }
  });

  document.getElementById("fontesList")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='remove-fonte']");
    if (!btn) {
      return;
    }
    const id = btn.getAttribute("data-fonte-id");
    if (id) {
      removeFonte(id);
    }
  });

  function bindAiModalAnexos(prefix) {
    const alertFn = prefix === "gerarProva" ? showGerarProvaAlert : showGerarQuestaoAlert;
    document.getElementById(`${prefix}AnexarBtn`)?.addEventListener("click", () => {
      document.getElementById(`${prefix}AnexarFile`)?.click();
    });
    document.getElementById(`${prefix}AnexarFile`)?.addEventListener("change", async (e) => {
      const errs = await addModalAnexosFromFiles(prefix, e.target.files);
      e.target.value = "";
      if (errs.length) {
        alertFn(errs.join(" "));
      }
    });
    document.getElementById(`${prefix}AnexosList`)?.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-action="remove-modal-anexo"]');
      if (!btn || btn.getAttribute("data-prefix") !== prefix) {
        return;
      }
      const id = btn.getAttribute("data-anexo-id");
      if (id) {
        removeModalAnexo(prefix, id);
      }
    });
  }

  bindAiModalAnexos("gerarQuestao");
  bindAiModalAnexos("gerarProva");

  document.getElementById("questionsRoot")?.addEventListener("click", (e) => {
    if (e.target.closest("#btnGerarProvaCta")) {
      openGerarProvaModal();
    }
  });

  document.getElementById("btnGerarQuestao")?.addEventListener("click", () => {
    openGerarQuestaoModal();
  });

  document.getElementById("gerarQuestaoConfirm")?.addEventListener("click", () => {
    runGerarQuestaoConfirm();
  });

  document.getElementById("gerarProvaConfirm")?.addEventListener("click", () => {
    runGerarProvaConfirm();
  });

  document.getElementById("importPrClear")?.addEventListener("click", () => {
    clearPrLoadedState();
  });

  document.getElementById("gerarQuestaoQuantidade")?.addEventListener("change", (e) => {
    let v = parseInt(e.target.value, 10);
    if (Number.isNaN(v) || v < 1) {
      v = 1;
    }
    if (v > 5) {
      v = 5;
    }
    e.target.value = String(v);
  });

  document.getElementById("gerarProvaQuantidade")?.addEventListener("change", (e) => {
    let v = parseInt(e.target.value, 10);
    if (Number.isNaN(v) || v < 1) {
      v = 1;
    }
    if (v > 15) {
      v = 15;
    }
    e.target.value = String(v);
  });

  hydrateMetaFromSession();
  render();
  updateProvaTabBadge();
  renderFontesPane();
  document.querySelectorAll(".question-card").forEach(syncPanels);
  document.getElementById("apiStatusBtn")?.addEventListener("click", () => {
    if (!apiOnline) {
      openApiOfflineModal();
    }
  });

  document.getElementById("aiStatusBtn")?.addEventListener("click", () => {
    if (!aiOnline) {
      openAiLocalModal();
    }
  });

  document.getElementById("btnGerarProvas")?.addEventListener("click", () => {
    if (gerarProvasInFlight) {
      return;
    }
    if (!apiOnline) {
      openApiOfflineModal();
      return;
    }
    openGerarProvasModal();
  });

  document.getElementById("gerarProvasConfirm")?.addEventListener("click", () => {
    runGerarProvasConfirm();
  });

  document.getElementById("gerarProvasQuantidade")?.addEventListener("change", (e) => {
    let v = parseInt(e.target.value, 10);
    if (Number.isNaN(v) || v < 1) {
      v = 1;
    }
    if (v > 30) {
      v = 30;
    }
    e.target.value = String(v);
  });

  document.getElementById("btnVerPdf")?.addEventListener("click", () => {
    if (state.generatedPdfObjectUrl) {
      window.open(state.generatedPdfObjectUrl, "_blank", "noopener,noreferrer");
    }
  });

  if (globalThis.editorChatGpb) {
    globalThis.editorChatGpb.onStatusChange(setAiUiVisible);
  } else {
    setAiUiVisible(false);
  }
  if (globalThis.editorBackendApi) {
    globalThis.editorBackendApi.onStatusChange(setApiUiOnline);
  } else {
    setApiUiOnline(false, { issue: "network", hint: null });
  }
})();