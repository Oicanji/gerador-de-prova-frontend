(function () {
  const STORAGE_KEY = "ifsc-editor-pr-chat-gpb-url";
  const DEFAULT_BASE_URL = "http://127.0.0.1:8765";
  const POLL_MS = 30000;

  const SCHEMA_MELHORAR_CAMPO = {
    type: "object",
    properties: {
      texto: { type: "string" },
    },
    required: ["texto"],
  };

  const PAPEL_LABELS = {
    enunciado: "enunciado da questao",
    afirmacao: "afirmacao de verdadeiro/falso",
    coluna_esquerda: "item da coluna esquerda (relacionar)",
    coluna_direita: "item da coluna direita (relacionar)",
  };

  const SCHEMA_MC = {
    type: "object",
    properties: {
      opcao1: { type: "string" },
      opcao2: { type: "string" },
      opcao3: { type: "string" },
      opcao4: { type: "string" },
      pergunta_correta: {
        type: "string",
        enum: ["opcao1", "opcao2", "opcao3", "opcao4"],
      },
    },
    required: ["opcao1", "opcao2", "opcao3", "opcao4", "pergunta_correta"],
  };

  const SCHEMA_VF = {
    type: "object",
    properties: {
      afirmacao1: { type: "string" },
      afirmacao2: { type: "string" },
      afirmacao3: { type: "string" },
      afirmacao4: { type: "string" },
      vf1: { type: "string", enum: ["V", "F"] },
      vf2: { type: "string", enum: ["V", "F"] },
      vf3: { type: "string", enum: ["V", "F"] },
      vf4: { type: "string", enum: ["V", "F"] },
      combinacao1: { type: "string" },
      combinacao2: { type: "string" },
      combinacao3: { type: "string" },
      combinacao4: { type: "string" },
      combinacao_correta: {
        type: "string",
        enum: ["opcao1", "opcao2", "opcao3", "opcao4"],
      },
    },
    required: [
      "afirmacao1",
      "afirmacao2",
      "afirmacao3",
      "afirmacao4",
      "vf1",
      "vf2",
      "vf3",
      "vf4",
      "combinacao1",
      "combinacao2",
      "combinacao3",
      "combinacao4",
      "combinacao_correta",
    ],
  };

  const SCHEMA_DISC = {
    type: "object",
    properties: {
      pergunta: { type: "string" },
      linhas: { type: "integer", minimum: 1, maximum: 20 },
    },
    required: ["pergunta"],
  };

  const SCHEMA_RELACIONAR = {
    type: "object",
    properties: {
      coluna_esquerda: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 6,
      },
      coluna_direita: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 6,
      },
      combinacoes: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 6,
      },
      combinacao_correta: {
        type: "string",
        enum: ["opcao1", "opcao2", "opcao3", "opcao4"],
      },
    },
    required: ["coluna_esquerda", "coluna_direita", "combinacoes", "combinacao_correta"],
  };

  const TIPO_LABELS = {
    "multipla-escolha": "multipla escolha",
    discursiva: "discursiva",
    verdadeiro_falso: "verdadeiro ou falso",
    relacionar: "relacionar (duas colunas)",
  };

  let online = false;
  let pollTimer = null;
  const statusListeners = [];

  function getBaseUrl() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && String(stored).trim()) {
        return String(stored).trim().replace(/\/$/, "");
      }
    } catch (_) {}
    return DEFAULT_BASE_URL;
  }

  function notifyStatus(next) {
    if (next === online) return;
    online = next;
    statusListeners.forEach((fn) => {
      try {
        fn(online);
      } catch (_) {}
    });
  }

  async function checkHealth() {
    try {
      const res = await fetch(`${getBaseUrl()}/health`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) {
        notifyStatus(false);
        return false;
      }
      const data = await res.json();
      const isOnline =
        data &&
        data.ok === true &&
        data.ollama === true &&
        data.model_available !== false;
      notifyStatus(isOnline);
      return isOnline;
    } catch (_) {
      notifyStatus(false);
      return false;
    }
  }

  function salvageQuestoesFrom422Body(errBody, responseSchema) {
    if (!responseSchema || !responseSchema.properties || !responseSchema.properties.questoes) {
      return null;
    }
    let block = errBody && errBody.detail;
    if (block && typeof block === "object" && block.detail && !block.raw_content) {
      block = block.detail;
    }
    const raw = block && typeof block === "object" ? block.raw_content : null;
    if (!raw || typeof raw !== "string") {
      return null;
    }
    try {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.questoes) && data.questoes.length) {
        return data;
      }
    } catch (_) {}
    return null;
  }

  async function callStructured(messages, responseSchema) {
    const res = await fetch(`${getBaseUrl()}/api/chat/structured`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        response_schema: responseSchema,
        inject_context: false,
      }),
    });
    if (!res.ok) {
      let detail = `Erro ${res.status}`;
      let errBody = null;
      try {
        errBody = await res.json();
        if (errBody && errBody.detail) {
          detail =
            typeof errBody.detail === "string"
              ? errBody.detail
              : errBody.detail.detail || JSON.stringify(errBody.detail);
        }
        if (res.status === 422) {
          const salvaged = salvageQuestoesFrom422Body(errBody, responseSchema);
          if (salvaged) {
            return salvaged;
          }
        }
      } catch (_) {}
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function buildMelhorarCampoMessages(texto, context) {
    const ctx = context || {};
    const tipo = ctx.tipo || "multipla-escolha";
    const tipoLabel = TIPO_LABELS[tipo] || tipo;
    const papel = ctx.papel || "enunciado";
    const papelLabel = PAPEL_LABELS[papel] || papel;
    const enunciado = String(ctx.pergunta || "").trim();
    const lines = [
      "Voce reescreve UM unico trecho de uma questao de prova em portugues do Brasil.",
      "Retorne somente o texto melhorado no campo texto, sem explicacoes.",
      `Tipo da questao: ${tipoLabel}.`,
      `Trecho a melhorar (${papelLabel}):`,
      "",
      texto,
    ];
    if (papel === "enunciado") {
      lines.splice(
        2,
        0,
        "Deixe claro e objetivo; nao inclua gabarito nem alternativas.",
        tipo === "verdadeiro_falso"
          ? "Nao liste afirmacoes nem sequencias V/F no enunciado."
          : ""
      );
    } else {
      lines.splice(
        2,
        0,
        "Mantenha coerencia com o enunciado da questao.",
        "Nao revele gabarito nem resposta correta.",
        papel === "afirmacao"
          ? "A afirmacao deve ser uma frase avaliavel como V ou F, sem escrever V ou F no texto."
          : "O item deve ser curto e correlacionavel com a coluna oposta.",
        enunciado ? "" : ""
      );
      if (enunciado) {
        lines.push("", "Enunciado da questao (contexto):", enunciado);
      }
    }
    return [{ role: "user", content: lines.filter(Boolean).join("\n") }];
  }

  function buildMcMessages(pergunta) {
    return [
      {
        role: "user",
        content: [
          "Voce e o sugestor automatico de alternativas de perguntas de multipla escolha.",
          "Com base no enunciado abaixo, elabore exatamente 4 opcoes:",
          "1) a correta;",
          "2) muito similar a correta, porem incorreta;",
          "3) dificuldade media, incorreta;",
          "4) obviamente errada.",
          "Indique qual chave (opcao1 a opcao4) e a correta em pergunta_correta.",
          "",
          pergunta,
        ].join("\n"),
      },
    ];
  }

  function appendVfFormatInstructions(lines, opts) {
    const o = opts || {};
    const enunciadoJaFornecido = !!o.enunciadoJaFornecido;
    lines.push(
      "",
      "FORMATO VERDADEIRO/FALSO NO PDF (siga exatamente em cada questao):",
      enunciadoJaFornecido
        ? "1) ENUNCIADO: contexto ou pergunta geral (ja fornecido abaixo)."
        : "1) ENUNCIADO: campo pergunta = contexto ou pergunta geral. NAO liste afirmacoes nem V/F no enunciado.",
      "2) AFIRMACOES (afirmacao1 a afirmacao4): quatro frases sobre o tema do enunciado.",
      "   Cada afirmacao e um enunciado completo que o aluno julga V ou F.",
      "   NAO escreva 'V' ou 'F' dentro do texto da afirmacao.",
      "   As afirmacoes devem ser coerentes com o enunciado e entre si.",
      "3) GABARITO (vf1 a vf4): para cada afirmacao, apenas 'V' se for verdadeira ou 'F' se for falsa.",
      "4) COMBINACOES (combinacao1 a combinacao4): quatro sequencias no padrao 'V, V, F e F'.",
      "   Cada combinacao tem exatamente 4 letras V ou F, na mesma ordem das afirmacoes 1 a 4.",
      "   Sao as alternativas de resposta (a, b, c, d) da segunda parte da questao.",
      "   Uma combinacao deve repetir exatamente vf1,vf2,vf3,vf4 (ex.: vf1=V, vf2=F, vf3=V, vf4=F -> 'V, F, V e F').",
      "   As outras tres combinacoes devem ser sequencias diferentes (distratores plausiveis).",
      "5) combinacao_correta: chave opcao1..opcao4 da combinacao que iguala o gabarito vf1..vf4.",
      "",
      "EXEMPLO (estrutura, nao copie o conteudo):",
      "pergunta: Sobre stakeholders em projetos de software.",
      "afirmacao1: Todo stakeholder e necessariamente um investidor financeiro.",
      "afirmacao2: O cliente do projeto e um stakeholder.",
      "afirmacao3: Stakeholders nao influenciam requisitos do sistema.",
      "afirmacao4: A equipe de desenvolvimento pode ser stakeholder.",
      "vf1=F, vf2=V, vf3=F, vf4=V",
      "combinacao1: F, V, F, V  (incorreta)",
      "combinacao2: F, V, F e V  (CORRETA - igual ao gabarito)",
      "combinacao3: V, V, V e V",
      "combinacao4: F, F, F e F",
      "combinacao_correta: opcao2",
      "",
      "REGRAS:",
      "- Use o tema e vocabulario do ENUNCIADO; nao invente assunto diferente.",
      "- Afirmacoes: claras, avaliaveis, sem ambiguidade excessiva.",
      "- Pelo menos uma afirmacao verdadeira e uma falsa.",
      "- Combinacoes: somente padrao V/F separado por virgula; ultimo item com ' e ' antes (ex.: 'V, F, V e F').",
      "- NAO use campos opcao1..4 nem array opcoes para V/F; use somente afirmacao1..4.",
      "- PROIBIDO em afirmacao1..4: apenas Verdadeiro, Falso, Sim, Nao ou pares Sim/Nao.",
      "- PROIBIDO em combinacao1..4: texto afirmacao1, opcao2, etc. Somente sequencias V/F (ex.: V, F, V e F)."
    );
  }

  function buildVfMessages(pergunta, context) {
    const lines = [
      "Voce monta questoes de VERDADEIRO/FALSO para o gerador de provas IFSC.",
    ];
    appendVfFormatInstructions(lines, { enunciadoJaFornecido: true });
    lines.push("", "ENUNCIADO DA QUESTAO:", pergunta);
    if (context) {
      const afirm = Array.isArray(context.opcoes)
        ? context.opcoes.map((s) => String(s || "").trim()).filter(Boolean)
        : [];
      const combs = Array.isArray(context.combinacoes)
        ? context.combinacoes.map((s) => String(s || "").trim()).filter(Boolean)
        : [];
      if (afirm.length) {
        lines.push("", "Afirmacoes ja no editor (pode reescrever mantendo o tema):");
        afirm.forEach((a, i) => lines.push(`${i + 1}) ${a}`));
      }
      if (combs.length) {
        lines.push("", "Combinacoes ja no editor (substitua por novas se necessario):");
        combs.forEach((c, i) => lines.push(`${String.fromCharCode(97 + i)}) ${c}`));
      }
    }
    return [{ role: "user", content: lines.join("\n") }];
  }

  function buildRelacionarMessages(pergunta) {
    return [
      {
        role: "user",
        content: [
          "Voce gera questoes de correlacionar (duas colunas) para prova.",
          "Com base no enunciado, crie 4 itens na coluna esquerda e 4 na direita (mesmo numero de itens).",
          "Crie 4 alternativas de correcao no estilo 'I, IV, III, II' (numeros romanos das linhas).",
          "Indique a combinacao correta em combinacao_correta (opcao1 a opcao4).",
          "",
          pergunta,
        ].join("\n"),
      },
    ];
  }

  const FONTE_TEXTO_MAX = 58000;

  function prepararTextoFonte(texto) {
    let s = String(texto || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/^\s*AULA\s+\d+\s*$/gim, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (s.length <= FONTE_TEXTO_MAX) {
      return s;
    }
    return s.slice(0, FONTE_TEXTO_MAX) + "\n[...]";
  }

  function schemaItemGerarQuestao(tipo) {
    if (tipo === "discursiva") {
      return SCHEMA_DISC;
    }
    if (tipo === "verdadeiro_falso") {
      return {
        type: "object",
        properties: {
          pergunta: { type: "string" },
          ...SCHEMA_VF.properties,
        },
        required: ["pergunta", ...SCHEMA_VF.required],
      };
    }
    if (tipo === "relacionar") {
      return {
        type: "object",
        properties: {
          pergunta: { type: "string" },
          ...SCHEMA_RELACIONAR.properties,
        },
        required: ["pergunta", ...SCHEMA_RELACIONAR.required],
      };
    }
    return {
      type: "object",
      properties: {
        pergunta: { type: "string" },
        ...SCHEMA_MC.properties,
      },
      required: ["pergunta", ...SCHEMA_MC.required],
    };
  }

  const GERAR_QUESTOES_MAX = 15;

  function clampGerarQuantidade(quantidade) {
    return Math.min(GERAR_QUESTOES_MAX, Math.max(1, quantidade || 1));
  }

  function buildSchemaGerarQuestoes(tipo, quantidade) {
    const n = clampGerarQuantidade(quantidade);
    return {
      type: "object",
      properties: {
        questoes: {
          type: "array",
          items: schemaItemGerarQuestao(tipo),
          minItems: n,
          maxItems: n,
        },
      },
      required: ["questoes"],
    };
  }

  function buildGerarQuestoesMessages(context) {
    const ctx = context || {};
    const tipo = ctx.tipo || "multipla-escolha";
    const tipoLabel = TIPO_LABELS[tipo] || tipo;
    const quantidade = clampGerarQuantidade(ctx.quantidade);
    const tema = String(ctx.tema || "").trim();
    const trechos = (Array.isArray(ctx.trechosFontes) ? ctx.trechosFontes : [])
      .map((t) => ({
        basename: String(t.basename || "fonte"),
        texto: String(t.texto || "").trim(),
      }))
      .filter((t) => t.texto);
    const perguntas =
      !tema && !trechos.length && Array.isArray(ctx.perguntasExistentes)
        ? ctx.perguntasExistentes
        : [];
    const hasTema = !!tema;
    const hasTrechos = trechos.length > 0;
    const parts = [
      `Gere ${quantidade} questao(oes) do tipo ${tipoLabel}. Portugues BR. Preencha o JSON conforme o schema (array questoes).`,
    ];
    if (quantidade > 5) {
      parts.push(
        "Varie enunciados e assuntos; nao repita a mesma pergunta com pequenas mudancas."
      );
    }
    if (tipo === "multipla-escolha") {
      parts.push("MC: pergunta + opcao1..4 + pergunta_correta (opcao1..opcao4).");
    } else if (tipo === "discursiva") {
      parts.push("Discursiva: pergunta + linhas (numero inteiro, padrao 3).");
    } else if (tipo === "verdadeiro_falso") {
      parts.push(
        "V/F: pergunta (contexto); afirmacao1..4 (frases, sem V/F no texto); vf1..4 = V ou F; combinacao1..4 = sequencias V/F (ex.: V, F, V e F); combinacao_correta = opcao1, opcao2, opcao3 ou opcao4."
      );
    } else if (tipo === "relacionar") {
      parts.push(
        "Relacionar: pergunta + coluna_esquerda/direita (4 itens) + combinacoes + combinacao_correta."
      );
    }
    if (hasTrechos) {
      trechos.forEach((t) => {
        parts.push(`\n[${t.basename}]\n${prepararTextoFonte(t.texto)}`);
      });
    }
    if (hasTema && hasTrechos) {
      parts.push(`\nFoco adicional: ${tema}\nUse o foco e o texto da(s) fonte(s) acima.`);
    } else if (hasTema) {
      parts.push(`\nFoco: ${tema}`);
    } else if (hasTrechos) {
      parts.push("\nBaseie-se somente no texto da(s) fonte(s) acima.");
    } else if (perguntas.length) {
      parts.push("\nAlinhe ao assunto destas questoes do editor:");
      perguntas.slice(0, 8).forEach((p, i) => {
        parts.push(`${i + 1}. ${p.pergunta}`);
      });
    }
    return [{ role: "user", content: parts.join("\n") }];
  }

  async function gerarQuestoes(context) {
    const ctx = context || {};
    const tipo = ctx.tipo || "multipla-escolha";
    const quantidade = clampGerarQuantidade(ctx.quantidade);
    return callStructured(
      buildGerarQuestoesMessages(ctx),
      buildSchemaGerarQuestoes(tipo, quantidade)
    );
  }

  async function melhorarCampo(texto, context) {
    return callStructured(buildMelhorarCampoMessages(texto, context), SCHEMA_MELHORAR_CAMPO);
  }

  async function gerarOpcoesMc(pergunta) {
    return callStructured(buildMcMessages(pergunta), SCHEMA_MC);
  }

  async function gerarOpcoesVf(pergunta, context) {
    return callStructured(buildVfMessages(pergunta, context), SCHEMA_VF);
  }

  async function gerarOpcoesRelacionar(pergunta) {
    return callStructured(buildRelacionarMessages(pergunta), SCHEMA_RELACIONAR);
  }

  function onStatusChange(callback) {
    if (typeof callback === "function") {
      statusListeners.push(callback);
      callback(online);
    }
  }

  function startStatusPolling() {
    checkHealth();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(checkHealth, POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        checkHealth();
      }
    });
  }

  globalThis.editorChatGpb = {
    getBaseUrl,
    isOnline: () => online,
    checkHealth,
    callStructured,
    melhorarCampo,
    gerarOpcoesMc,
    gerarOpcoesVf,
    gerarOpcoesRelacionar,
    gerarQuestoes,
    onStatusChange,
    startStatusPolling,
  };

  const host = typeof location !== "undefined" ? location.hostname : "";
  const localChatGpb =
    host === "localhost" ||
    host === "127.0.0.1" ||
    (typeof location !== "undefined" && location.protocol === "file:");
  if (localChatGpb) {
    startStatusPolling();
  } else {
    notifyStatus(false);
  }
})();
