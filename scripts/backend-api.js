(function () {
  const STORAGE_URL_KEY = "ifsc-editor-pr-backend-url";
  const DEFAULT_BASE_URL = "https://gerador-prova-api.oicanji.workers.dev";
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const HEALTH_POLL_MS = 60000;
  const JOB_POLL_MS = 5000;
  const MAX_QUANTIDADE = 30;
  const FETCH_RETRY_MAX = 8;
  const FETCH_RETRY_MS = 3000;
  const WAKE_MAX_ATTEMPTS = 90;
  const WAKE_MS = 2000;

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

  function isRetryableStatus(status) {
    return status === 524 || status === 502 || status === 503 || status === 504;
  }

  async function fetchWithRetry(url, init, label) {
    let lastErr = null;
    for (let attempt = 0; attempt < FETCH_RETRY_MAX; attempt += 1) {
      try {
        const res = await fetch(url, init);
        if (isRetryableStatus(res.status) && attempt < FETCH_RETRY_MAX - 1) {
          await sleep(FETCH_RETRY_MS * (attempt + 1));
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt < FETCH_RETRY_MAX - 1) {
          await sleep(FETCH_RETRY_MS * (attempt + 1));
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
        "Timeout Cloudflare (524): o Render demorou a responder. " +
        "Aguarde o indicador de servidor acordar e tente de novo."
      );
    }
    try {
      const data = await res.json();
      if (data && data.error) return String(data.error);
    } catch (_) {}
    return `Erro ${res.status}`;
  }

  async function pingWorker() {
    try {
      const res = await fetch(`${getBaseUrl()}/health`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data && data.status === "ok";
    } catch (_) {
      return false;
    }
  }

  async function pingBackendRender() {
    try {
      const res = await fetch(`${getBaseUrl()}/health/backend`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data && data.status === "ok";
    } catch (_) {
      return false;
    }
  }

  async function ensureBackendAwake() {
    for (let i = 0; i < WAKE_MAX_ATTEMPTS; i += 1) {
      if (await pingBackendRender()) {
        healthDetail = { issue: null, hint: null };
        notifyStatus(true);
        return true;
      }
      healthDetail = {
        issue: "server",
        hint: "Acordando servidor no Render (pode levar 1-2 min)...",
      };
      notifyStatus(await pingWorker());
      await sleep(WAKE_MS);
    }
    throw new Error(
      "Servidor de geracao nao respondeu a tempo. Aguarde um minuto e clique em Gerar provas novamente."
    );
  }

  async function checkHealth() {
    healthDetail = { issue: null, hint: null };
    const workerOk = await pingWorker();
    if (!workerOk) {
      healthDetail = {
        issue: "network",
        hint: "Proxy Cloudflare inacessivel.",
      };
      notifyStatus(false);
      return false;
    }
    const renderOk = await pingBackendRender();
    if (renderOk) {
      healthDetail = { issue: null, hint: null };
      notifyStatus(true);
      return true;
    }
    healthDetail = {
      issue: "server",
      hint: "Proxy ok; servidor Render dormindo (geracao de provas aguarda acordar).",
    };
    notifyStatus(true);
    return true;
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

  function jobSettled(status) {
    return (
      status === "queued" ||
      status === "processing" ||
      status === "completed" ||
      status === "failed"
    );
  }

  async function finishUploadAndStart(jobId) {
    const res = await fetchWithRetry(
      jobApi(`/jobs/${encodeURIComponent(jobId)}/upload/finish`),
      { method: "POST", headers: authHeaders() },
      "Finalizar upload e enfileirar geracao"
    );
    if (res.ok) {
      return res.json().catch(() => ({}));
    }
    if (res.status === 409 || res.status === 524) {
      const st = await getJobStatus(jobId);
      if (
        st.status === "processing" ||
        st.status === "completed" ||
        st.status === "queued"
      ) {
        return { jobId, status: st.status, recovered: true };
      }
    }
    throw new Error(await parseErrorBody(res));
  }

  async function createJobChunkedUpload(prBlob, filename, quantidade, randomizar, gerarGabarito) {
    await ensureBackendAwake();
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
    const jobId = session.jobId;
    const chunkSize = session.chunkSize || CHUNK_SIZE;
    const totalChunks = session.uploadChunks || Math.ceil(prSize / chunkSize);
    for (let i = 0; i < totalChunks; i += 1) {
      const start = i * chunkSize;
      const end = Math.min(prSize, start + chunkSize);
      const slice = prBlob.slice(start, end);
      const putRes = await fetchWithRetry(
        jobApi(`/jobs/${encodeURIComponent(jobId)}/upload/${i}`),
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
    await ensureBackendAwake();
    await finishUploadAndStart(jobId);
    return { jobId, quantidade: session.quantidade || quantidade };
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
      let status;
      try {
        status = await getJobStatus(jobId);
      } catch (err) {
        const msg = err && err.message ? String(err.message) : "";
        if (msg.includes("524") || msg.includes("502") || msg.includes("503")) {
          await sleep(JOB_POLL_MS);
          continue;
        }
        throw err;
      }
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
      await sleep(JOB_POLL_MS);
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
      if (i === 0 || i % 3 === 0) {
        await ensureBackendAwake();
      }
      const res = await fetchWithRetry(
        jobApi(`/jobs/${encodeURIComponent(jobId)}/result/chunk/${part}/${i}`),
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
    await ensureBackendAwake();
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
    ensureBackendAwake,
    onStatusChange,
    startGeneration,
    getApiKey,
  };
})();
