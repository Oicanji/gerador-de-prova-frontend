(function () {
  const STORAGE_URL_KEY = "ifsc-editor-pr-backend-url";
  const DEFAULT_BASE_URL = "https://gerador-prova-api.oicanji.workers.dev";
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const HEALTH_POLL_MS = 120000;
  const JOB_POLL_MS = 3000;
  const MAX_QUANTIDADE = 30;
  const POLL_RETRY_MAX = 120;

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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function jobApi(path) {
    return `${getBaseUrl()}/api/v1${path}`;
  }

  async function parseErrorBody(res) {
    if (res.status === 524) {
      return "Timeout (524): o servidor nao respondeu a tempo. Tente de novo em alguns segundos.";
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
      const res = await fetch(`${getBaseUrl()}/health`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) {
        healthDetail = { issue: "network", hint: "Proxy inacessivel." };
        notifyStatus(false);
        return false;
      }
      const data = await res.json();
      const ok = data && data.status === "ok";
      notifyStatus(ok);
      return ok;
    } catch (_) {
      healthDetail = { issue: "network", hint: "Sem conexao com o proxy." };
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

  async function createJob(prBlob, filename, quantidade, randomizar, gerarGabarito) {
    const key = getApiKey();
    if (!key) {
      throw new Error("Chave API nao configurada em scripts/config.js");
    }
    const q = Math.max(1, Math.min(MAX_QUANTIDADE, parseInt(String(quantidade), 10) || 1));
    const form = new FormData();
    form.append("file", prBlob, filename || "fonte.pr");
    form.append("quantidade", String(q));
    form.append("randomizar", randomizar !== false ? "sim" : "nao");
    form.append("gerar_gabarito", gerarGabarito !== false ? "sim" : "nao");

    const res = await fetch(jobApi("/jobs"), {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) {
      throw new Error(await parseErrorBody(res));
    }
    const data = await res.json();
    if (!data || !data.jobId) {
      throw new Error("Resposta invalida ao criar job.");
    }
    return { jobId: data.jobId, quantidade: data.quantidade || q };
  }

  async function getJobStatus(jobId) {
    const res = await fetch(jobApi(`/jobs/${encodeURIComponent(jobId)}`), {
      method: "GET",
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(await parseErrorBody(res));
    }
    return res.json();
  }

  async function waitForJob(jobId, onProgress) {
    for (let attempt = 0; attempt < POLL_RETRY_MAX; attempt += 1) {
      try {
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
      } catch (err) {
        const msg = err && err.message ? String(err.message) : "";
        if (!msg.includes("524") && !msg.includes("502") && !msg.includes("503")) {
          throw err;
        }
      }
      await sleep(JOB_POLL_MS);
    }
    throw new Error("Tempo esgotado aguardando a geracao das provas.");
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
      const res = await fetch(
        jobApi(`/jobs/${encodeURIComponent(jobId)}/result/chunk/${part}/${i}`),
        { method: "GET", headers: authHeaders(), cache: "no-store" }
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
    const infoRes = await fetch(jobApi(`/jobs/${encodeURIComponent(jobId)}/result/info`), {
      method: "GET",
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!infoRes.ok) {
      throw new Error(await parseErrorBody(infoRes));
    }
    const meta = await infoRes.json();
    const prUpdatedBuffer = await downloadPartInChunks(jobId, "pr", meta, onProgress);
    const pdfBuffer = await downloadPartInChunks(jobId, "pdf", meta, onProgress);
    try {
      await fetch(jobApi(`/jobs/${encodeURIComponent(jobId)}/result/ack`), {
        method: "POST",
        headers: authHeaders(),
      });
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
