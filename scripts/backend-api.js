(function () {
  const STORAGE_URL_KEY = "ifsc-editor-pr-backend-url";
  const DEFAULT_BASE_URL = "https://gerador-prova-api.oicanji.workers.dev";
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const HEALTH_POLL_MS = 15000;
  const JOB_POLL_MS = 5000;
  const MAX_QUANTIDADE = 30;
  const FETCH_RETRY_MAX = 4;
  const FETCH_RETRY_MS = 2500;

  const cfg =
    typeof globalThis.EDITOR_BACKEND_CONFIG === "object" && globalThis.EDITOR_BACKEND_CONFIG
      ? globalThis.EDITOR_BACKEND_CONFIG
      : {};

  let online = false;
  let healthTimer = null;
  let healthDetail = { issue: null, hint: null };
  const statusListeners = [];

  function getApiKey() {
    const k = cfg.API_KEY;
    return k && String(k).trim() ? String(k).trim() : "";
  }

  function getBaseUrl() {
    try {
      const stored = localStorage.getItem(STORAGE_URL_KEY);
      if (stored && String(stored).trim()) {
        return String(stored).trim().replace(/\/$/, "");
      }
    } catch (_) {}
    const fromCfg = cfg.BACKEND_BASE_URL;
    if (fromCfg && String(fromCfg).trim()) {
      return String(fromCfg).trim().replace(/\/$/, "");
    }
    return DEFAULT_BASE_URL;
  }

  function notifyStatus(next) {
    online = next;
    statusListeners.forEach((fn) => {
      try {
        fn(online, { ...healthDetail });
      } catch (_) {}
    });
  }

  function authHeaders(extra) {
    const headers = { ...(extra || {}) };
    const key = getApiKey();
    if (key) {
      headers["X-API-Key"] = key;
    }
    return headers;
  }

  function isRetryableStatus(status) {
    return status === 524 || status === 502 || status === 503 || status === 504;
  }

  async function fetchWithRetry(url, init, label) {
    let lastErr = null;
    for (let attempt = 0; attempt < FETCH_RETRY_MAX; attempt += 1) {
      try {
        const res = await fetch(url, init);
        if (isRetryableStatus(res.status) && attempt < FETCH_RETRY_MAX - 1) {
          await new Promise((r) => setTimeout(r, FETCH_RETRY_MS * (attempt + 1)));
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt < FETCH_RETRY_MAX - 1) {
          await new Promise((r) => setTimeout(r, FETCH_RETRY_MS * (attempt + 1)));
          continue;
        }
      }
    }
    if (lastErr) {
      throw new Error(
        `${label || "Requisicao"} falhou: ${lastErr.message || lastErr}. Servidor pode estar iniciando.`
      );
    }
    throw new Error(`${label || "Requisicao"} falhou apos varias tentativas.`);
  }

  async function parseErrorBody(res) {
    if (res.status === 524) {
      return (
        "Timeout Cloudflare (524). Tente de novo em instantes; o servidor no Render pode estar acordando. " +
        "O editor envia o .pr e baixa o PDF em pedacos de ate 5 MB pelo Worker."
      );
    }
    try {
      const data = await res.json();
      if (data && data.error) return String(data.error);
    } catch (_) {}
    return `Erro ${res.status}`;
  }

  async function checkHealth() {
    healthDetail = { issue: null, hint: null };
    try {
      const res = await fetchWithRetry(
        `${getBaseUrl()}/health`,
        { method: "GET", cache: "no-store" },
        "Health"
      );
      if (!res.ok) {
        healthDetail = {
          issue: "server",
          hint: "O servidor respondeu com erro. Pode estar iniciando no Render.",
        };
        notifyStatus(false);
        return false;
      }
      const data = await res.json();
      const isOnline = data && data.status === "ok";
      if (isOnline) {
        healthDetail = { issue: null, hint: null };
      } else {
        healthDetail = { issue: "server", hint: "Resposta inesperada do servidor." };
      }
      notifyStatus(isOnline);
      return isOnline;
    } catch (err) {
      healthDetail = {
        issue: "network",
        hint: "Provavelmente o servidor esta dormindo. Tente novamente em alguns minutos.",
      };
      notifyStatus(false);
      return false;
    }
  }

  function startHealthPolling() {
    if (healthTimer) return;
    checkHealth();
    healthTimer = setInterval(checkHealth, HEALTH_POLL_MS);
  }

  function onStatusChange(fn) {
    if (typeof fn === "function") {
      statusListeners.push(fn);
      try {
        fn(online, { ...healthDetail });
      } catch (_) {}
    }
  }

  function getHealthDetail() {
    return { ...healthDetail };
  }

  function jobApi(path) {
    return `${getBaseUrl()}/api/v1${path}`;
  }

  async function createJobChunkedUpload(prBlob, filename, quantidade, randomizar, gerarGabarito) {
    const prSize = prBlob.size;
    const sessionRes = await fetchWithRetry(
      jobApi("/jobs/session"),
      {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          filename: filename || "fonte.pr",
          prSize,
          quantidade,
          randomizar: randomizar !== false ? "sim" : "nao",
          gerar_gabarito: gerarGabarito !== false ? "sim" : "nao",
        }),
      },
      "Criar sessao de upload"
    );
    if (!sessionRes.ok) {
      throw new Error(await parseErrorBody(sessionRes));
    }
    const session = await sessionRes.json();
    if (!session || !session.jobId) {
      throw new Error("Resposta invalida ao criar sessao de upload.");
    }
    const chunkSize = session.chunkSize || CHUNK_SIZE;
    const totalChunks = session.uploadChunks || Math.ceil(prSize / chunkSize);
    for (let i = 0; i < totalChunks; i += 1) {
      const start = i * chunkSize;
      const end = Math.min(prSize, start + chunkSize);
      const slice = prBlob.slice(start, end);
      const putRes = await fetchWithRetry(
        jobApi(`/jobs/${encodeURIComponent(session.jobId)}/upload/${i}`),
        {
          method: "PUT",
          headers: authHeaders({ "Content-Type": "application/octet-stream" }),
          body: slice,
        },
        `Upload chunk ${i + 1}/${totalChunks}`
      );
      if (!putRes.ok) {
        throw new Error(await parseErrorBody(putRes));
      }
    }
    const finishRes = await fetchWithRetry(
      jobApi(`/jobs/${encodeURIComponent(session.jobId)}/upload/finish`),
      { method: "POST", headers: authHeaders() },
      "Finalizar upload"
    );
    if (!finishRes.ok) {
      throw new Error(await parseErrorBody(finishRes));
    }
    return { jobId: session.jobId, quantidade: session.quantidade || quantidade };
  }

  async function createJob(prBlob, filename, quantidade, randomizar, gerarGabarito) {
    const key = getApiKey();
    if (!key) {
      throw new Error("Chave API nao configurada em scripts/config.js");
    }
    const q = Math.max(1, Math.min(MAX_QUANTIDADE, parseInt(String(quantidade), 10) || 1));
    return createJobChunkedUpload(prBlob, filename, q, randomizar, gerarGabarito);
  }

  async function getJobStatus(jobId) {
    const res = await fetchWithRetry(
      jobApi(`/jobs/${encodeURIComponent(jobId)}`),
      { method: "GET", headers: authHeaders(), cache: "no-store" },
      "Status do job"
    );
    if (!res.ok) {
      throw new Error(await parseErrorBody(res));
    }
    return res.json();
  }

  async function waitForJob(jobId, onProgress) {
    for (;;) {
      const status = await getJobStatus(jobId);
      if (onProgress) {
        try {
          onProgress(status);
        } catch (_) {}
      }
      if (status.status === "completed") {
        return status;
      }
      if (status.status === "failed") {
        throw new Error(status.error || "Falha na geracao das provas.");
      }
      await new Promise((r) => setTimeout(r, JOB_POLL_MS));
    }
  }

  function concatChunks(chunks, totalSize) {
    const out = new Uint8Array(totalSize);
    let offset = 0;
    for (const part of chunks) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out.buffer;
  }

  async function downloadPartInChunks(jobId, part, meta, onProgress) {
    const partMeta = meta[part];
    if (!partMeta || !partMeta.totalChunks) {
      throw new Error(`Metadados ausentes para ${part}.`);
    }
    const chunks = [];
    for (let i = 0; i < partMeta.totalChunks; i += 1) {
      const res = await fetchWithRetry(
        jobApi(
          `/jobs/${encodeURIComponent(jobId)}/result/chunk/${part}/${i}`
        ),
        { method: "GET", headers: authHeaders(), cache: "no-store" },
        `Download ${part} ${i + 1}/${partMeta.totalChunks}`
      );
      if (!res.ok) {
        throw new Error(await parseErrorBody(res));
      }
      const buf = await res.arrayBuffer();
      chunks.push(new Uint8Array(buf));
      if (onProgress) {
        onProgress({
          phase: "download",
          part,
          current: i + 1,
          total: partMeta.totalChunks,
        });
      }
    }
    return concatChunks(chunks, partMeta.size);
  }

  async function downloadResultChunked(jobId, onProgress) {
    const infoRes = await fetchWithRetry(
      jobApi(`/jobs/${encodeURIComponent(jobId)}/result/info`),
      { method: "GET", headers: authHeaders(), cache: "no-store" },
      "Info do resultado"
    );
    if (!infoRes.ok) {
      throw new Error(await parseErrorBody(infoRes));
    }
    const meta = await infoRes.json();
    const prUpdatedBuffer = await downloadPartInChunks(jobId, "pr", meta, onProgress);
    const pdfBuffer = await downloadPartInChunks(jobId, "pdf", meta, onProgress);
    try {
      await fetchWithRetry(
        jobApi(`/jobs/${encodeURIComponent(jobId)}/result/ack`),
        { method: "POST", headers: authHeaders() },
        "Ack resultado"
      );
    } catch (_) {}
    const pdfBlob = new Blob([pdfBuffer], { type: "application/pdf" });
    return { prUpdatedBuffer, pdfBlob };
  }

  async function startGeneration({
    prBlob,
    filename,
    quantidade,
    randomizar = true,
    gerarGabarito = true,
    onProgress
  }) {
    await checkHealth();
    const { jobId } = await createJob(prBlob, filename, quantidade, randomizar, gerarGabarito);
    const completed = await waitForJob(jobId, onProgress);
    const extracted = await downloadResultChunked(jobId, onProgress);
    return {
      ...extracted,
      examCount:
        completed.result && typeof completed.result.examCount === "number"
          ? completed.result.examCount
          : quantidade,
      jobId,
    };
  }

  startHealthPolling();

  globalThis.editorBackendApi = {
    getBaseUrl,
    isOnline: () => online,
    getHealthDetail,
    checkHealth,
    onStatusChange,
    startGeneration,
    getApiKey,
  };
})();
