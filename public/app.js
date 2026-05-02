function getAdminToken() {
  return localStorage.getItem("adminToken") || "";
}

function setAdminToken(token) {
  localStorage.setItem("adminToken", token || "");
}

function getLang() {
  const raw = localStorage.getItem("lang") || "";
  const lang = raw.trim().toLowerCase();
  return lang === "en" ? "en" : "zh";
}

function setLang(lang) {
  localStorage.setItem("lang", lang === "en" ? "en" : "zh");
}

function getMonitorSelectedKeyIds() {
  const raw = localStorage.getItem("monitorSelectedKeyIds") || "[]";
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => String(s)).filter(Boolean);
  } catch {
    return [];
  }
}

function setMonitorSelectedKeyIds(ids) {
  const unique = Array.from(new Set((ids || []).map((s) => String(s)).filter(Boolean)));
  localStorage.setItem("monitorSelectedKeyIds", JSON.stringify(unique));
}

function isBarsEnabled() {
  const raw = localStorage.getItem("monitorShowBars");
  if (raw === null) return true;
  return raw === "1";
}

function setBarsEnabled(v) {
  localStorage.setItem("monitorShowBars", v ? "1" : "0");
}

function isLineEnabled() {
  const raw = localStorage.getItem("monitorShowLine");
  if (raw === null) return true;
  return raw === "1";
}

function setLineEnabled(v) {
  localStorage.setItem("monitorShowLine", v ? "1" : "0");
}

const I18N = {
  zh: {
    "app.pageTitle": "llm-key-lb",
    "app.title": "llm-key-lb",
    "app.subtitle": "本地 APIKey 管理 + 轮询代理",

    "btn.lang.zh": "中文",
    "btn.lang.en": "EN",
    "btn.setToken": "设置管理令牌",
    "btn.help": "帮助",
    "btn.refresh": "刷新",
    "btn.add": "添加",
    "btn.edit": "编辑",
    "btn.enable": "启用",
    "btn.disable": "禁用",
    "btn.delete": "删除",
    "btn.deleteConfirm": "确认删除",
    "btn.cancel": "取消",
    "btn.save": "保存",

    "help.endpoints": "- 管理界面：http://localhost:8787/\n- 健康检查：http://localhost:8787/health\n- OpenAI 兼容入口：http://localhost:8787/v1\n- Prometheus 指标：http://localhost:8787/metrics",
    "help.model": "- 建议留空：让其他 app 在请求里自行指定 model（更灵活）。\n- 只有需要限制该 Key 只能用于某些模型时，才在这里设置 Model。",
    "help.weight": "- 默认 1。\n- 权重越大，在同一 provider/model 池里被选中的次数越多。\n- 建议按各家 RPM/TPM 或稳定性来调。",
    "modal.edit.title": "编辑 Key",
    "modal.token.title": "设置管理令牌",
    "modal.field.name": "名称",
    "modal.field.baseUrl": "Base URL",
    "modal.field.models": "Models(逗号分隔,留空=全模型)",
    "modal.field.apiKey": "API Key",
    "modal.field.adminToken": "ADMIN_TOKEN",
    "modal.field.weight": "轮询权重",
    "modal.ph.apiKeyKeep": "留空=不改",
    "modal.ph.weight": "默认 1",
    "modal.token.desc": "ADMIN_TOKEN 用于保护 /admin/* 管理接口。\n当服务端设置了环境变量 ADMIN_TOKEN 后，所有管理接口必须携带请求头：x-admin-token: <ADMIN_TOKEN> 才能访问。",
    "modal.token.note": "这里设置的令牌只保存在本机（浏览器/应用的 localStorage），不会上传，也不会写入状态文件。\n留空并保存 = 清除本机保存的令牌。",
    "modal.token.example": "示例（命令行调用管理接口）：\ncurl -H \"x-admin-token: <ADMIN_TOKEN>\" http://localhost:8787/admin/keys",

    "section.launcher": "启动",
    "launcher.desc": "设置端口并启动服务（默认 8787）。",
    "launcher.port": "端口",
    "launcher.btn.start": "启动",
    "launcher.starting": "正在启动…",
    "launcher.started": "已启动：{url}",
    "launcher.portInvalid": "端口无效，请输入 1-65535",
    "launcher.portInUse": "端口已被占用，请换一个",
    "launcher.startFail": "启动失败：{message}",

    "section.addKey": "新增 APIKey",
    "section.keys": "已管理的 Keys",
    "section.usage": "使用方式",
    "section.monitor": "监控",
    "monitor.desc": "展示本进程内的请求统计；同时支持 Prometheus 抓取 /metrics。",
    "monitor.empty": "暂无统计数据，先发起一些请求。",
    "monitor.metricsLink": "Prometheus 指标：/metrics",
    "monitor.col.key": "Key",
    "monitor.col.provider": "厂商",
    "monitor.col.enabled": "启用",
    "monitor.col.total": "总请求",
    "monitor.col.success": "成功",
    "monitor.col.failure": "失败",
    "monitor.col.cooldown": "冷却",
    "monitor.col.avgLatency": "平均耗时",
    "monitor.col.last": "最近一次",
    "monitor.col.select": "选中",
    "monitor.toggle.bars": "柱状图",
    "monitor.toggle.line": "折线(耗时)",
    "monitor.selected": "已选择 {count} 个 Key",
    "monitor.selected.none": "未选择 Key（在上表勾选后显示图表）",
    "monitor.chart.loading": "加载图表中…",
    "monitor.chart.noData": "暂无图表数据",
    "monitor.legend.latency": "平均耗时",

    "form.provider": "厂商",
    "form.name": "名称",
    "form.baseUrl": "Base URL",
    "form.model": "Model（留空表示全模型）",
    "form.modelCustom": "自定义 Model",
    "form.apiKey": "API Key",
    "form.weight": "轮询权重",
    "form.enabled": "启用",

    "ph.name": "可选，便于区分",
    "ph.baseUrl": "例如 https://api.openai.com/v1",
    "ph.modelCustom": "例如 gpt-4o-mini",
    "ph.apiKey": "必填",
    "ph.weight": "默认 1",

    "provider.openai": "OpenAI",
    "provider.gemini": "Gemini (OpenAI 兼容)",
    "provider.deepseek": "DeepSeek (OpenAI 兼容)",
    "provider.custom": "自定义 (OpenAI 兼容)",

    "model.all": "(留空=全模型)",
    "model.custom": "自定义...",
    "models.all": "全模型",

    "usage.desc": "把你业务里 OpenAI SDK 的 baseURL 指向本服务，并保持路径是 /v1。",
    "usage.python": "Python(OpenAI SDK)：",
    "usage.js": "JS/TS(OpenAI SDK)：",
    "usage.tip": "提示：真正的上游 key 在本服务里配置；业务侧的 api_key 只要随便填一个非空字符串即可。",

    "keys.empty": "暂无 Key，先在上面添加一个。",
    "table.name": "名称",
    "table.provider": "厂商",
    "table.baseUrl": "Base URL",
    "table.models": "Model",
    "table.weight": "权重",
    "table.key": "Key",
    "table.status": "状态",
    "table.actions": "操作",

    "status.disabled": "禁用",
    "status.ok": "正常 (fail={failures})",
    "status.cooldown": "冷却中 {seconds}s (fail={failures})",

    "prompt.adminToken": "输入 ADMIN_TOKEN（未设置则留空）",
    "prompt.delete": "删除 {name} ?",
    "prompt.name": "名称",
    "prompt.baseUrl": "Base URL",
    "prompt.models": "Models(逗号分隔,留空=全模型)",
    "prompt.apiKey": "API Key(留空=不改)",

    "msg.addOk": "添加成功",
    "msg.addFail": "添加失败：{message}",
    "msg.editOk": "更新成功",
    "msg.editFail": "更新失败：{message}",
    "msg.deleteOk": "删除成功",
    "msg.deleteConfirm": "再次点击“确认删除”以删除 {name}",
    "msg.deleteFail": "删除失败：{message}",
    "msg.loadFail": "加载失败：{message}"
  },
  en: {
    "app.pageTitle": "llm-key-lb",
    "app.title": "llm-key-lb",
    "app.subtitle": "Local API key manager + round-robin proxy",

    "btn.lang.zh": "中文",
    "btn.lang.en": "EN",
    "btn.setToken": "Set admin token",
    "btn.help": "Help",
    "btn.refresh": "Refresh",
    "btn.add": "Add",
    "btn.edit": "Edit",
    "btn.enable": "Enable",
    "btn.disable": "Disable",
    "btn.delete": "Delete",
    "btn.deleteConfirm": "Confirm delete",
    "btn.cancel": "Cancel",
    "btn.save": "Save",

    "help.endpoints": "- UI: http://localhost:8787/\n- Health: http://localhost:8787/health\n- OpenAI-compatible API: http://localhost:8787/v1\n- Prometheus metrics: http://localhost:8787/metrics",
    "help.model": "- Keep this empty if you want apps to choose models per request.\n- Set model(s) here only if you want to restrict which models this key can use.",
    "help.weight": "- Default is 1.\n- Higher weight = selected more often within the same provider/model pool.\n- Tune based on each upstream's rate limits or stability.",
    "modal.edit.title": "Edit key",
    "modal.token.title": "Set admin token",
    "modal.field.name": "Name",
    "modal.field.baseUrl": "Base URL",
    "modal.field.models": "Models (comma-separated, empty = all)",
    "modal.field.apiKey": "API Key",
    "modal.field.adminToken": "ADMIN_TOKEN",
    "modal.field.weight": "Weight",
    "modal.ph.apiKeyKeep": "Empty = keep unchanged",
    "modal.ph.weight": "Default 1",
    "modal.token.desc": "ADMIN_TOKEN protects /admin/* management endpoints.\nIf the server sets env ADMIN_TOKEN, admin APIs require header: x-admin-token: <ADMIN_TOKEN>.",
    "modal.token.note": "This token is stored locally (browser/app localStorage) only. It is not uploaded and not written to the state file.\nSave empty = clear the local token.",
    "modal.token.example": "Example (call admin API from CLI):\ncurl -H \"x-admin-token: <ADMIN_TOKEN>\" http://localhost:8787/admin/keys",

    "section.launcher": "Start",
    "launcher.desc": "Choose a port and start the service (default 8787).",
    "launcher.port": "Port",
    "launcher.btn.start": "Start",
    "launcher.starting": "Starting…",
    "launcher.started": "Started: {url}",
    "launcher.portInvalid": "Invalid port. Use 1-65535",
    "launcher.portInUse": "Port is already in use. Choose another",
    "launcher.startFail": "Start failed: {message}",

    "section.addKey": "Add API Key",
    "section.keys": "Managed Keys",
    "section.usage": "Usage",
    "section.monitor": "Monitoring",
    "monitor.desc": "Shows in-process request stats; Prometheus can scrape /metrics.",
    "monitor.empty": "No stats yet. Send some requests first.",
    "monitor.metricsLink": "Prometheus metrics: /metrics",
    "monitor.col.key": "Key",
    "monitor.col.provider": "Provider",
    "monitor.col.enabled": "Enabled",
    "monitor.col.total": "Total",
    "monitor.col.success": "Success",
    "monitor.col.failure": "Failure",
    "monitor.col.cooldown": "Cooldown",
    "monitor.col.avgLatency": "Avg latency",
    "monitor.col.last": "Last",
    "monitor.col.select": "Select",
    "monitor.toggle.bars": "Bars",
    "monitor.toggle.line": "Line (latency)",
    "monitor.selected": "{count} key(s) selected",
    "monitor.selected.none": "No keys selected (tick checkboxes above to show charts)",
    "monitor.chart.loading": "Loading chart…",
    "monitor.chart.noData": "No chart data",
    "monitor.legend.latency": "Avg latency",

    "form.provider": "Provider",
    "form.name": "Name",
    "form.baseUrl": "Base URL",
    "form.model": "Model (empty = all models)",
    "form.modelCustom": "Custom model",
    "form.apiKey": "API Key",
    "form.weight": "Weight",
    "form.enabled": "Enabled",

    "ph.name": "Optional, for distinguishing keys",
    "ph.baseUrl": "e.g. https://api.openai.com/v1",
    "ph.modelCustom": "e.g. gpt-4o-mini",
    "ph.apiKey": "Required",
    "ph.weight": "Default 1",

    "provider.openai": "OpenAI",
    "provider.gemini": "Gemini (OpenAI-compatible)",
    "provider.deepseek": "DeepSeek (OpenAI-compatible)",
    "provider.custom": "Custom (OpenAI-compatible)",

    "model.all": "(empty = all models)",
    "model.custom": "Custom...",
    "models.all": "All",

    "usage.desc": "Point your OpenAI SDK baseURL to this service and keep the /v1 path.",
    "usage.python": "Python (OpenAI SDK):",
    "usage.js": "JS/TS (OpenAI SDK):",
    "usage.tip": "Tip: upstream keys live here. In your app, api_key can be any non-empty string.",

    "keys.empty": "No keys yet. Add one above.",
    "table.name": "Name",
    "table.provider": "Provider",
    "table.baseUrl": "Base URL",
    "table.models": "Model",
    "table.weight": "Weight",
    "table.key": "Key",
    "table.status": "Status",
    "table.actions": "Actions",

    "status.disabled": "Disabled",
    "status.ok": "OK (fail={failures})",
    "status.cooldown": "Cooling down {seconds}s (fail={failures})",

    "prompt.adminToken": "Enter ADMIN_TOKEN (leave empty if not set)",
    "prompt.delete": "Delete {name} ?",
    "prompt.name": "Name",
    "prompt.baseUrl": "Base URL",
    "prompt.models": "Models (comma-separated, empty = all)",
    "prompt.apiKey": "API Key (empty = keep unchanged)",

    "msg.addOk": "Added",
    "msg.addFail": "Add failed: {message}",
    "msg.editOk": "Updated",
    "msg.editFail": "Update failed: {message}",
    "msg.deleteOk": "Deleted",
    "msg.deleteConfirm": "Click “Confirm delete” again to delete {name}",
    "msg.deleteFail": "Delete failed: {message}",
    "msg.loadFail": "Load failed: {message}"
  }
};

function currentLang() {
  return getLang();
}

function t(key, vars = {}) {
  const lang = currentLang();
  const dict = I18N[lang] || I18N.zh;
  const template = dict[key] || I18N.zh[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
}

function hasTranslation(key) {
  const lang = currentLang();
  return Boolean((I18N[lang] && I18N[lang][key]) || (I18N.zh && I18N.zh[key]));
}

function applyI18n() {
  const lang = currentLang();
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  document.title = t("app.pageTitle");

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    node.textContent = t(key);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    const key = node.getAttribute("data-i18n-placeholder");
    node.setAttribute("placeholder", t(key));
  });

  const btn = document.getElementById("btnLangToggle");
  if (btn) btn.textContent = lang === "en" ? t("btn.lang.zh") : t("btn.lang.en");
}

function headers() {
  const h = { "content-type": "application/json" };
  const token = getAdminToken();
  if (token) h["x-admin-token"] = token;
  return h;
}

async function api(path, init = {}) {
  const res = await fetch(path, { cache: "no-store", ...init });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v === false || v === null || v === undefined) return;
    else n.setAttribute(k, String(v));
  });
  children.forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return n;
}

function getModalEls() {
  return {
    overlay: document.getElementById("modalOverlay"),
    title: document.getElementById("modalTitle"),
    body: document.getElementById("modalBody"),
    hint: document.getElementById("modalHint"),
    btnOk: document.getElementById("modalOk"),
    btnCancel: document.getElementById("modalCancel"),
    btnClose: document.getElementById("modalClose")
  };
}

function closeModal() {
  const m = getModalEls();
  if (!m.overlay) return;
  m.overlay.style.display = "none";
  m.overlay.setAttribute("aria-hidden", "true");
  if (m.title) m.title.removeAttribute("data-i18n");
  if (m.body) m.body.innerHTML = "";
  if (m.hint) {
    m.hint.textContent = "";
    m.hint.classList.remove("error");
  }
  if (m.btnOk) m.btnOk.disabled = false;
}

function openModal({ titleKey, bodyNodes, onOk, closeOnBackdrop = false }) {
  const m = getModalEls();
  if (!m.overlay || !m.title || !m.body || !m.btnOk || !m.btnCancel || !m.btnClose) return;

  m.title.setAttribute("data-i18n", titleKey);
  m.btnOk.setAttribute("data-i18n", "btn.save");
  m.btnCancel.setAttribute("data-i18n", "btn.cancel");

  m.body.innerHTML = "";
  (bodyNodes || []).forEach((n) => m.body.appendChild(n));

  if (m.hint) {
    m.hint.textContent = "";
    m.hint.classList.remove("error");
  }

  m.overlay.style.display = "";
  m.overlay.setAttribute("aria-hidden", "false");
  applyI18n();

  const firstInput = m.body.querySelector("input,textarea,select");
  if (firstInput && typeof firstInput.focus === "function") firstInput.focus();

  m.overlay.onclick = (e) => {
    if (closeOnBackdrop && e.target === m.overlay) closeModal();
  };
  m.btnCancel.onclick = () => closeModal();
  m.btnClose.onclick = () => closeModal();
  m.btnOk.onclick = async () => {
    if (typeof onOk !== "function") {
      closeModal();
      return;
    }
    m.btnOk.disabled = true;
    try {
      await onOk();
    } finally {
      m.btnOk.disabled = false;
    }
  };
}

function openEditKeyModal({ key, hint, onDone }) {
  const inputName = el("input");
  inputName.value = key && key.name ? String(key.name) : "";

  const inputBaseUrl = el("input");
  inputBaseUrl.value = key && key.baseUrl ? String(key.baseUrl) : "";

  const inputModels = el("input");
  inputModels.value = key && Array.isArray(key.models) ? key.models.join(",") : "";

  const inputWeight = el("input", { type: "number", min: "1", step: "1", inputmode: "numeric", "data-i18n-placeholder": "modal.ph.weight" });
  inputWeight.value = key && key.weight ? String(key.weight) : "1";

  const inputApiKey = el("input", { type: "password", "data-i18n-placeholder": "modal.ph.apiKeyKeep" });

  openModal({
    titleKey: "modal.edit.title",
    bodyNodes: [
      el("label", {}, [el("span", { "data-i18n": "modal.field.name" }), inputName]),
      el("label", {}, [el("span", { "data-i18n": "modal.field.baseUrl" }), inputBaseUrl]),
      el("label", {}, [el("span", { "data-i18n": "modal.field.models" }), inputModels]),
      el("label", {}, [el("span", { "data-i18n": "modal.field.weight" }), inputWeight]),
      el("label", {}, [el("span", { "data-i18n": "modal.field.apiKey" }), inputApiKey])
    ],
    onOk: async () => {
      const m = getModalEls();
      if (m.hint) {
        m.hint.textContent = "";
        m.hint.classList.remove("error");
      }
      try {
        await api(`/admin/keys/${key.id}`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify({
            name: inputName.value,
            baseUrl: inputBaseUrl.value,
            models: splitModels(inputModels.value),
            weight: inputWeight.value,
            apiKey: inputApiKey.value
          })
        });
        closeModal();
        if (hint) {
          hint.textContent = t("msg.editOk");
          hint.classList.remove("error");
        }
        if (typeof onDone === "function") await onDone();
      } catch (e) {
        if (m.hint) {
          m.hint.textContent = t("msg.editFail", { message: e.message });
          m.hint.classList.add("error");
        }
      }
    }
  });
}

function openAdminTokenModal({ onDone } = {}) {
  const cur = getAdminToken();
  const inputToken = el("input");
  inputToken.value = cur;

  openModal({
    titleKey: "modal.token.title",
    bodyNodes: [
      el("div", { class: "modalNote", "data-i18n": "modal.token.desc" }),
      el("label", {}, [el("span", { "data-i18n": "modal.field.adminToken" }), inputToken]),
      el("div", { class: "modalNote", "data-i18n": "modal.token.note" }),
      el("pre", { class: "codeBox", "data-i18n": "modal.token.example" })
    ],
    onOk: async () => {
      const m = getModalEls();
      if (m.hint) {
        m.hint.textContent = "";
        m.hint.classList.remove("error");
      }
      setAdminToken((inputToken.value || "").trim());
      closeModal();
      if (typeof onDone === "function") await onDone();
    }
  });
}

function splitModels(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function setModelCustomVisible(visible) {
  const wrap = document.getElementById("modelCustomWrap");
  const input = document.getElementById("modelCustom");
  wrap.style.display = visible ? "" : "none";
  if (!visible) input.value = "";
}

function renderModelOptions(models) {
  const select = document.getElementById("modelSelect");
  select.innerHTML = "";
  select.appendChild(el("option", { value: "" }, [t("model.all")]));
  select.appendChild(el("option", { value: "__custom__" }, [t("model.custom")]));
  (models || []).forEach((m) => {
    select.appendChild(el("option", { value: m }, [m]));
  });
  select.value = "";
  setModelCustomVisible(false);
}

function fillUsage() {
  const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  const baseUrl = `${window.location.protocol}//${window.location.hostname}:${port}/v1`;
  const text = [
    t("usage.python"),
    `from openai import OpenAI`,
    `client = OpenAI(api_key="DUMMY", base_url="${baseUrl}")`,
    "",
    t("usage.js"),
    `import OpenAI from "openai";`,
    `const client = new OpenAI({ apiKey: "DUMMY", baseURL: "${baseUrl}" });`,
    "",
    t("usage.tip")
  ].join("\n");
  document.getElementById("usageText").textContent = text;
}

async function loadPresets() {
  const data = await api("/admin/presets", { headers: headers() });
  return data.presets || {};
}

async function loadKeys() {
  const data = await api("/admin/keys", { headers: headers() });
  return data.keys || [];
}

async function loadStats() {
  const data = await api("/admin/stats", { headers: headers() });
  return data.items || [];
}

async function loadTimeseries(ids) {
  const qs = ids && ids.length ? `?ids=${encodeURIComponent(ids.join(","))}` : "";
  return api(`/admin/timeseries${qs}`, { headers: headers() });
}

function formatDurationMs(ms) {
  if (ms === null || ms === undefined) return "-";
  const n = Number(ms);
  if (!Number.isFinite(n)) return "-";
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(2)}s`;
  return `${(n / 60_000).toFixed(2)}m`;
}

function formatTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function hashToIndex(str, mod) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % mod;
}

const SERIES_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb7185", "#22d3ee", "#4ade80", "#eab308", "#f97316"];

function colorForKeyId(id) {
  return SERIES_COLORS[hashToIndex(String(id), SERIES_COLORS.length)];
}

function formatHm(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function svgEl(tag, attrs = {}, children = []) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    n.setAttribute(k, String(v));
  });
  children.forEach((c) => n.appendChild(c));
  return n;
}

function ensureToggleDefaults() {
  const bars = document.getElementById("toggleBars");
  const line = document.getElementById("toggleLine");
  if (bars) bars.checked = isBarsEnabled();
  if (line) line.checked = isLineEnabled();
}

function setSelectedHint(ids) {
  const node = document.getElementById("monitorSelectedHint");
  if (!node) return;
  node.textContent = ids.length ? t("monitor.selected", { count: ids.length }) : t("monitor.selected.none");
}

function renderChartPlaceholder(text) {
  const root = document.getElementById("chart");
  if (!root) return;
  root.innerHTML = "";
  root.appendChild(el("div", { class: "muted" }, [text]));
}

function renderChart(timeseries, { showBars, showLine }) {
  const root = document.getElementById("chart");
  if (!root) return;

  const series = (timeseries && timeseries.series) || [];
  if (!series.length || !series[0].points || !series[0].points.length) {
    renderChartPlaceholder(t("monitor.chart.noData"));
    return;
  }

  const pointsCount = series[0].points.length;
  const buckets = series[0].points.map((p) => p.t);
  const totals = buckets.map((_, idx) => series.reduce((sum, s) => sum + (s.points[idx] ? s.points[idx].count || 0 : 0), 0));
  const maxCount = Math.max(1, ...totals);

  const latencyByBucket = buckets.map((_, idx) => {
    let sum = 0;
    let cnt = 0;
    series.forEach((s) => {
      const p = s.points[idx];
      if (!p) return;
      const ms = p.avgLatencyMs;
      const c = Number(p.latencyCount || 0);
      if (ms === null || ms === undefined) return;
      if (!Number.isFinite(ms) || !Number.isFinite(c) || c <= 0) return;
      sum += ms * c;
      cnt += c;
    });
    if (!cnt) return null;
    return Math.round(sum / cnt);
  });
  const maxLatency = Math.max(1, ...latencyByBucket.filter((v) => v !== null));

  const width = 900;
  const height = 240;
  const padding = { left: 42, right: 16, top: 14, bottom: 34 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const barW = plotW / pointsCount;

  const legend = el("div", { class: "chartLegend" });
  series.forEach((s) => {
    const color = colorForKeyId(s.id);
    legend.appendChild(
      el("span", { class: "legendItem" }, [
        el("span", { class: "legendSwatch", style: `background:${color}` }),
        `${s.name || s.id}`
      ])
    );
  });
  if (showLine) {
    legend.appendChild(
      el("span", { class: "legendItem" }, [
        el("span", { class: "legendSwatch", style: "background:#e5e7eb" }),
        t("monitor.legend.latency")
      ])
    );
  }

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}` });
  svg.appendChild(svgEl("line", { x1: padding.left, y1: padding.top + plotH, x2: padding.left + plotW, y2: padding.top + plotH, stroke: "#334155", "stroke-width": 1 }));
  svg.appendChild(svgEl("line", { x1: padding.left, y1: padding.top, x2: padding.left, y2: padding.top + plotH, stroke: "#334155", "stroke-width": 1 }));

  const yGrid = 4;
  for (let i = 0; i <= yGrid; i += 1) {
    const y = padding.top + (plotH * i) / yGrid;
    const v = Math.round(maxCount * (1 - i / yGrid));
    svg.appendChild(svgEl("line", { x1: padding.left, y1: y, x2: padding.left + plotW, y2: y, stroke: "#1f2937", "stroke-width": 1 }));
    const label = svgEl("text", { x: padding.left - 6, y: y + 4, fill: "#9ca3af", "font-size": 10, "text-anchor": "end" });
    label.textContent = String(v);
    svg.appendChild(label);
  }

  if (showBars) {
    for (let idx = 0; idx < pointsCount; idx += 1) {
      let stack = 0;
      series.forEach((s) => {
        const p = s.points[idx];
        const success = p ? p.success || 0 : 0;
        const failure = p ? p.failure || 0 : 0;
        if (!success && !failure) return;

        const color = colorForKeyId(s.id);
        const w = Math.max(1, barW - 2);

        if (success > 0) {
          const h = (success / maxCount) * plotH;
          const y = padding.top + plotH - h - stack;
          svg.appendChild(svgEl("rect", { x: padding.left + idx * barW + 1, y, width: w, height: h, fill: color, opacity: 0.3 }));
          stack += h;
        }

        if (failure > 0) {
          const h = (failure / maxCount) * plotH;
          const y = padding.top + plotH - h - stack;
          svg.appendChild(svgEl("rect", { x: padding.left + idx * barW + 1, y, width: w, height: h, fill: color, opacity: 1.0 }));
          stack += h;
        }
      });
    }
  }

  if (showLine) {
    let d = "";
    for (let idx = 0; idx < pointsCount; idx += 1) {
      const ms = latencyByBucket[idx];
      if (ms === null) continue;
      const x = padding.left + idx * barW + barW / 2;
      const y = padding.top + plotH - (ms / maxLatency) * plotH;
      d += d ? ` L ${x.toFixed(2)} ${y.toFixed(2)}` : `M ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    if (d) svg.appendChild(svgEl("path", { d, fill: "none", stroke: "#e5e7eb", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  }

  const labelEvery = Math.max(1, Math.floor(pointsCount / 6));
  for (let idx = 0; idx < pointsCount; idx += 1) {
    if (idx % labelEvery !== 0 && idx !== pointsCount - 1) continue;
    const x = padding.left + idx * barW + barW / 2;
    const y = padding.top + plotH + 18;
    const label = svgEl("text", { x, y, fill: "#9ca3af", "font-size": 10, "text-anchor": "middle" });
    label.textContent = formatHm(buckets[idx]);
    svg.appendChild(label);
  }

  root.innerHTML = "";
  root.appendChild(legend);
  root.appendChild(svg);
}

async function refreshMonitorChart() {
  const selectedIds = getMonitorSelectedKeyIds();
  setSelectedHint(selectedIds);
  ensureToggleDefaults();
  if (!selectedIds.length) {
    renderChartPlaceholder(t("monitor.selected.none"));
    return;
  }
  renderChartPlaceholder(t("monitor.chart.loading"));
  try {
    const timeseries = await loadTimeseries(selectedIds);
    renderChart(timeseries, { showBars: isBarsEnabled(), showLine: isLineEnabled() });
  } catch (e) {
    renderChartPlaceholder(t("msg.loadFail", { message: e.message }));
  }
}

function renderStats(items) {
  const root = document.getElementById("stats");
  if (!root) return;
  if (!items.length) {
    root.innerHTML = "";
    root.appendChild(el("div", { class: "muted" }, [t("monitor.empty")]));
    root.appendChild(el("div", { class: "muted" }, [t("monitor.metricsLink")]));
    return;
  }

  const table = el("table", { class: "table" });
  const selected = new Set(getMonitorSelectedKeyIds());
  table.appendChild(
    el("thead", {}, [
      el("tr", {}, [
        el("th", { class: "checkboxCell" }, [t("monitor.col.select")]),
        el("th", {}, [t("monitor.col.key")]),
        el("th", {}, [t("monitor.col.provider")]),
        el("th", {}, [t("monitor.col.enabled")]),
        el("th", {}, [t("monitor.col.total")]),
        el("th", {}, [t("monitor.col.success")]),
        el("th", {}, [t("monitor.col.failure")]),
        el("th", {}, [t("monitor.col.cooldown")]),
        el("th", {}, [t("monitor.col.avgLatency")]),
        el("th", {}, [t("monitor.col.last")])
      ])
    ])
  );

  const tbody = el("tbody");
  items.forEach((it) => {
    const providerKey = `provider.${it.provider}`;
    const providerLabel = hasTranslation(providerKey) ? t(providerKey) : it.provider || "-";
    const enabledText = it.enabled ? "✓" : "-";
    const cooldown = it.cooldownUntil && Date.now() < it.cooldownUntil ? Math.ceil((it.cooldownUntil - Date.now()) / 1000) : 0;
    const cooldownText = cooldown ? `${cooldown}s` : "-";
    const checkbox = el("input", {
      type: "checkbox",
      checked: selected.has(it.id),
      onchange: async (e) => {
        const next = new Set(getMonitorSelectedKeyIds());
        if (e.target.checked) next.add(it.id);
        else next.delete(it.id);
        setMonitorSelectedKeyIds(Array.from(next));
        await refreshMonitorChart();
      }
    });

    tbody.appendChild(
      el("tr", {}, [
        el("td", { class: "checkboxCell" }, [checkbox]),
        el("td", {}, [it.name || it.id]),
        el("td", {}, [providerLabel]),
        el("td", {}, [enabledText]),
        el("td", {}, [String(it.total || 0)]),
        el("td", {}, [String(it.success || 0)]),
        el("td", {}, [String(it.failure || 0)]),
        el("td", {}, [cooldownText]),
        el("td", {}, [formatDurationMs(it.avgLatencyMs)]),
        el("td", {}, [`${it.lastStatus || "-"} @ ${formatTime(it.lastAt)}`])
      ])
    );
  });

  table.appendChild(tbody);
  root.innerHTML = "";
  root.appendChild(el("div", { class: "muted" }, [t("monitor.metricsLink")]));
  root.appendChild(table);
}

function renderProviderOptions(presets) {
  const select = document.getElementById("provider");
  const cur = select.value;
  select.innerHTML = "";
  Object.entries(presets).forEach(([key, p]) => {
    const label = I18N[currentLang()] && I18N[currentLang()][`provider.${key}`] ? t(`provider.${key}`) : p.label;
    select.appendChild(el("option", { value: key }, [`${label} (${key})`]));
  });
  if (cur) select.value = cur;
}

function applyPresetToForm(presets, provider) {
  const p = presets[provider];
  if (!p) return;
  const baseUrl = document.getElementById("baseUrl");
  baseUrl.value = p.baseUrl || "";
  renderModelOptions(p.models || []);
}

function renderKeys(keys, presets) {
  const root = document.getElementById("keys");
  const hint = document.getElementById("keysHint");
  if (!keys.length) {
    root.innerHTML = "";
    root.appendChild(el("div", { class: "muted" }, [t("keys.empty")]));
    if (hint) {
      hint.textContent = "";
      hint.classList.remove("error");
    }
    return;
  }

  const table = el("table", { class: "table keysTable" });
  table.appendChild(
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, [t("table.name")]),
        el("th", {}, [t("table.provider")]),
        el("th", {}, [t("table.baseUrl")]),
        el("th", {}, [t("table.models")]),
        el("th", {}, [t("table.weight")]),
        el("th", {}, [t("table.key")]),
        el("th", {}, [t("table.status")]),
        el("th", {}, [t("table.actions")])
      ])
    ])
  );

  const tbody = el("tbody");
  keys.forEach((k) => {
    const providerKey = `provider.${k.provider}`;
    const providerLabel = hasTranslation(providerKey)
      ? t(providerKey)
      : presets[k.provider]
        ? presets[k.provider].label
        : k.provider;
    const enabled = !!k.enabled;
    const cooldown = k.cooldownUntil && Date.now() < k.cooldownUntil ? Math.ceil((k.cooldownUntil - Date.now()) / 1000) : 0;

    const btnToggle = el(
      "button",
      {
        class: "secondary",
        onclick: async () => {
          await api(`/admin/keys/${k.id}`, {
            method: "PUT",
            headers: headers(),
            body: JSON.stringify({ enabled: !enabled })
          });
          await refreshAll();
        }
      },
      [enabled ? t("btn.disable") : t("btn.enable")]
    );

    const btnDelete = el(
      "button",
      {
        class: "danger",
        onclick: async () => {
          const btn = btnDelete;
          if (btn.dataset.confirming !== "1") {
            btn.dataset.confirming = "1";
            btn.textContent = t("btn.deleteConfirm");
            if (hint) {
              hint.textContent = t("msg.deleteConfirm", { name: k.name });
              hint.classList.remove("error");
            }
            setTimeout(() => {
              btn.dataset.confirming = "0";
              btn.textContent = t("btn.delete");
              if (hint && hint.textContent === t("msg.deleteConfirm", { name: k.name })) {
                hint.textContent = "";
                hint.classList.remove("error");
              }
            }, 2500);
            return;
          }

          btn.disabled = true;
          try {
            await api(`/admin/keys/${k.id}`, { method: "DELETE", headers: headers() });
            if (hint) {
              hint.textContent = t("msg.deleteOk");
              hint.classList.remove("error");
            }
            await refreshAll();
          } catch (e) {
            if (hint) {
              hint.textContent = t("msg.deleteFail", { message: e.message });
              hint.classList.add("error");
            }
          } finally {
            btn.disabled = false;
            btn.dataset.confirming = "0";
            btn.textContent = t("btn.delete");
          }
        }
      },
      [t("btn.delete")]
    );

    const btnEdit = el(
      "button",
      {
        class: "secondary",
        onclick: async () => {
          openEditKeyModal({ key: k, hint, onDone: refreshAll });
        }
      },
      [t("btn.edit")]
    );

    const statusText = enabled
      ? cooldown
        ? t("status.cooldown", { seconds: cooldown, failures: k.failures || 0 })
        : t("status.ok", { failures: k.failures || 0 })
      : t("status.disabled");

    tbody.appendChild(
      el("tr", {}, [
        el("td", {}, [k.name]),
        el("td", {}, [providerLabel]),
        el("td", { class: "colBaseUrl" }, [
          el("span", { class: "truncate", title: k.baseUrl || "" }, [k.baseUrl || ""])
        ]),
        el("td", {}, [(k.models || []).join(",") || t("models.all")]),
        el("td", {}, [String(k.weight || 1)]),
        el("td", {}, [k.apiKeyMasked || ""]),
        el("td", {}, [statusText]),
        el("td", { class: "rowActions" }, [btnEdit, btnToggle, btnDelete])
      ])
    );
  });
  table.appendChild(tbody);

  root.innerHTML = "";
  root.appendChild(table);
}

async function refreshAll() {
  document.getElementById("addHint").textContent = "";
  try {
    const presets = await loadPresets();
    renderProviderOptions(presets);
    const provider = document.getElementById("provider").value || Object.keys(presets)[0];
    applyPresetToForm(presets, provider);
    const keys = await loadKeys();
    renderKeys(keys, presets);
    const existingKeyIds = new Set(keys.map((k) => String(k.id)).filter(Boolean));
    const selected = getMonitorSelectedKeyIds();
    const filtered = selected.filter((id) => existingKeyIds.has(String(id)));
    if (filtered.length !== selected.length) {
      setMonitorSelectedKeyIds(filtered);
    }
    const stats = await loadStats();
    renderStats(stats);
    await refreshMonitorChart();
  } catch (e) {
    document.getElementById("keys").innerHTML = "";
    document.getElementById("keys").appendChild(el("div", { class: "error" }, [t("msg.loadFail", { message: e.message })]));
    renderChartPlaceholder(t("msg.loadFail", { message: e.message }));
  }
}

function setLauncherVisible(visible) {
  const card = document.getElementById("launcherCard");
  if (!card) return;
  card.style.display = visible ? "" : "none";
}

function hideNonLauncherSections() {
  document.querySelectorAll("main .card").forEach((node) => {
    if (node && node.id === "launcherCard") return;
    node.style.display = "none";
  });
  const btnSetToken = document.getElementById("btnSetToken");
  const btnRefresh = document.getElementById("btnRefresh");
  if (btnSetToken) btnSetToken.style.display = "none";
  if (btnRefresh) btnRefresh.style.display = "none";
}

async function fetchLauncherInfo() {
  try {
    const res = await fetch("/launcher/info", { headers: { "content-type": "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizePort(raw) {
  const n = Number(String(raw || "").trim());
  if (!Number.isFinite(n)) return null;
  const p = Math.trunc(n);
  if (p < 1 || p > 65535) return null;
  return p;
}

async function waitForHealth(url, timeoutMs = 12_000) {
  const startedAt = Date.now();
  const healthUrl = url.endsWith("/") ? `${url}health` : `${url}/health`;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(healthUrl, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

async function initLauncher(defaultPort) {
  hideNonLauncherSections();
  setLauncherVisible(true);

  const input = document.getElementById("launcherPort");
  const hint = document.getElementById("launcherHint");
  const form = document.getElementById("formLauncher");
  const btn = document.getElementById("btnLauncherStart");

  input.value = String(defaultPort || 8787);
  hint.textContent = "";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hint.textContent = "";
    hint.classList.remove("error");

    const port = normalizePort(input.value);
    if (!port) {
      hint.textContent = t("launcher.portInvalid");
      hint.classList.add("error");
      return;
    }

    btn.disabled = true;
    hint.textContent = t("launcher.starting");
    try {
      const res = await fetch("/launcher/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ port })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data && data.error ? data.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const url = data && data.url ? data.url : `http://localhost:${port}/`;
      hint.textContent = t("launcher.started", { url });

      const ok = await waitForHealth(url);
      if (ok) window.location.href = url;
      else window.location.href = url;
    } catch (err) {
      const msg = err.message === "port_in_use" ? t("launcher.portInUse") : err.message;
      hint.textContent = t("launcher.startFail", { message: msg });
      hint.classList.add("error");
      btn.disabled = false;
    }
  });
}

async function main() {
  applyI18n();
  const launcherInfo = await fetchLauncherInfo();
  if (launcherInfo && launcherInfo.launcher) {
    await initLauncher(launcherInfo.defaultPort || 8787);
    document.getElementById("btnLangToggle").addEventListener("click", async () => {
      setLang(currentLang() === "en" ? "zh" : "en");
      applyI18n();
    });
    return;
  }

  fillUsage();
  ensureToggleDefaults();
  setSelectedHint(getMonitorSelectedKeyIds());

  document.getElementById("btnLangToggle").addEventListener("click", async () => {
    setLang(currentLang() === "en" ? "zh" : "en");
    applyI18n();
    fillUsage();
    await refreshAll();
  });

  document.getElementById("btnSetToken").addEventListener("click", () => {
    openAdminTokenModal({ onDone: refreshAll });
  });

  document.getElementById("btnRefresh").addEventListener("click", refreshAll);

  document.getElementById("toggleBars").addEventListener("change", async (e) => {
    setBarsEnabled(e.target.checked);
    await refreshMonitorChart();
  });

  document.getElementById("toggleLine").addEventListener("change", async (e) => {
    setLineEnabled(e.target.checked);
    await refreshMonitorChart();
  });

  document.getElementById("modelSelect").addEventListener("change", (e) => {
    setModelCustomVisible(e.target.value === "__custom__");
  });

  document.getElementById("provider").addEventListener("change", async (e) => {
    try {
      const presets = await loadPresets();
      applyPresetToForm(presets, e.target.value);
    } catch {
      return;
    }
  });

  document.getElementById("formAdd").addEventListener("submit", async (e) => {
    e.preventDefault();
    const provider = document.getElementById("provider").value;
    const name = document.getElementById("name").value;
    const baseUrl = document.getElementById("baseUrl").value;
    const modelSelect = document.getElementById("modelSelect").value;
    const modelCustom = document.getElementById("modelCustom").value;
    const apiKey = document.getElementById("apiKey").value;
    const weight = document.getElementById("weight").value;
    const enabled = document.getElementById("enabled").checked;

    const selectedModel =
      modelSelect === "__custom__" ? modelCustom.trim() : (modelSelect || "").trim();

    try {
      await api("/admin/keys", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          provider,
          name,
          baseUrl,
          models: selectedModel ? [selectedModel] : [],
          apiKey,
          weight,
          enabled
        })
      });
      document.getElementById("apiKey").value = "";
      document.getElementById("weight").value = "1";
      document.getElementById("modelSelect").value = "";
      setModelCustomVisible(false);
      document.getElementById("addHint").textContent = t("msg.addOk");
      await refreshAll();
    } catch (err) {
      document.getElementById("addHint").textContent = t("msg.addFail", { message: err.message });
    }
  });

  await refreshAll();
}

main();
