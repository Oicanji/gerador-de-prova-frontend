(function () {
  const root = document.getElementById("questionsRoot");
  if (!root) return;
  root.addEventListener("click", function (e) {
    const mc = e.target.closest("[data-resposta-mc]");
    if (mc) {
      const api = window.__editorProvaPr;
      if (api && typeof api.handleSetRespostaMc === "function") {
        api.handleSetRespostaMc(mc);
      }
      return;
    }
    const vf = e.target.closest("[data-resposta-vf]");
    if (vf) {
      const api = window.__editorProvaPr;
      if (api && typeof api.handleSetRespostaVf === "function") {
        api.handleSetRespostaVf(vf);
      }
    }
  });
})();
