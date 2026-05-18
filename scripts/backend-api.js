(function () {
  const STORAGE_URL_KEY = "ifsc-editor-pr-backend-url";
  const DEFAULT_BASE_URL = "https://gerador-de-prova-backend.onrender.com";
  const HEALTH_POLL_MS = 15000;
  const JOB_POLL_MS = 5000;
  const MAX_QUANTIDADE = 30;

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

  async function parseErrorBody(res) {
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
        healthDetail = {
          issue: "server",
          hint: "O servidor respondeu com erro. Pode estar iniciando no OnRender.",
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
      const msg = err && err.message ? String(err.message) : "";
      healthDetail = {
        issue: "network",
        hint:
          "Nao foi possivel contactar a API a partir desta pagina. Causas comuns: extensao bloqueando (uBlock, AdBlock, Brave Shields) — veja ERR_BLOCKED_BY_CLIENT no console; ou CORS nao configurado no Render (variavel CORS_ORIGIN=https://oicanji.github.io). Abra o link de teste abaixo num separador: se mostrar {\"status\":\"ok\"} mas o icone continua cinza, e bloqueador ou CORS.",
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

  async function createJob(prBlob, filename, quantidade) {
    const key = getApiKey();
    if (!key) {
      throw new Error("Chave API nao configurada em scripts/config.js");
    }
    const q = Math.max(1, Math.min(MAX_QUANTIDADE, parseInt(String(quantidade), 10) || 1));
    const form = new FormData();
    form.append("file", prBlob, filename || "fonte.pr");
    form.append("quantidade", String(q));
    const res = await fetch(`${getBaseUrl()}/api/v1/jobs`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) {
      throw new Error(await parseErrorBody(res));
    }
    const data = await res.json();
    if (!data || !data.jobId) {
      throw new Error("Resposta invalida ao criar o job.");
    }
    return { jobId: data.jobId, quantidade: data.quantidade || q };
  }

  async function getJobStatus(jobId) {
    const res = await fetch(`${getBaseUrl()}/api/v1/jobs/${encodeURIComponent(jobId)}`, {
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

  async function downloadResult(jobId) {
    const res = await fetch(
      `${getBaseUrl()}/api/v1/jobs/${encodeURIComponent(jobId)}/result`,
      {
        method: "GET",
        headers: authHeaders(),
      }
    );
    if (!res.ok) {
      throw new Error(await parseErrorBody(res));
    }
    return res.arrayBuffer();
  }

  function findZipEntry(zip, baseName) {
    const keys = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
    const lower = baseName.toLowerCase();
    return keys.find((k) => {
      const base = k.split("/").pop();
      return base && base.toLowerCase() === lower;
    });
  }

  async function extractResultZip(arrayBuffer) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip nao carregou.");
    }
    const zip = await JSZip.loadAsync(arrayBuffer);
    const prKey = findZipEntry(zip, "prova-atualizada.pr");
    const pdfKey = findZipEntry(zip, "todas-provas.pdf");
    if (!prKey) {
      throw new Error("ZIP de resultado sem prova-atualizada.pr");
    }
    if (!pdfKey) {
      throw new Error("ZIP de resultado sem todas-provas.pdf");
    }
    const prUpdatedBuffer = await zip.file(prKey).async("arraybuffer");
    const pdfBlob = await zip.file(pdfKey).async("blob");
    return { prUpdatedBuffer, pdfBlob };
  }

  async function startGeneration({ prBlob, filename, quantidade, onProgress }) {
    const { jobId } = await createJob(prBlob, filename, quantidade);
    const completed = await waitForJob(jobId, onProgress);
    const zipBuffer = await downloadResult(jobId);
    const extracted = await extractResultZip(zipBuffer);
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
