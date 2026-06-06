/**
 * Popup script.
 * Sends messages to background service worker.
 */

declare const __WEB_URL__: string;

const tabCreate = document.getElementById("tab-create") as HTMLButtonElement;
const tabJoin = document.getElementById("tab-join") as HTMLButtonElement;
const joinExtras = document.getElementById("join-extras") as HTMLDivElement;
const formView = document.getElementById("form-view") as HTMLDivElement;
const sharingView = document.getElementById("sharing-view") as HTMLDivElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const codeInput = document.getElementById("code") as HTMLInputElement;
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const roomCodeEl = document.getElementById("room-code") as HTMLDivElement;
const roomLinkEl = document.getElementById("room-link") as HTMLInputElement;
const btnCopy = document.getElementById("btn-copy") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLDivElement;

let activeTab: "create" | "join" = "create";

// ── Check if already sharing ──────────────────────────────────────────────────
chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res: { sharing: boolean; code: string | null }) => {
  if (res?.sharing && res.code) {
    showSharingView(res.code);
  }
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
tabCreate.addEventListener("click", () => {
  activeTab = "create";
  tabCreate.classList.add("active");
  tabJoin.classList.remove("active");
  joinExtras.style.display = "none";
  btnStart.textContent = "Compartir esta pestaña";
});

tabJoin.addEventListener("click", () => {
  activeTab = "join";
  tabJoin.classList.add("active");
  tabCreate.classList.remove("active");
  joinExtras.style.display = "block";
  btnStart.textContent = "Unirse y compartir";
});

// ── Start ─────────────────────────────────────────────────────────────────────
btnStart.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  errorEl.textContent = "";

  if (!name) { errorEl.textContent = "Escribe tu nombre"; return; }
  if (activeTab === "join" && !code) { errorEl.textContent = "Escribe el código de sala"; return; }

  btnStart.disabled = true;
  statusEl.textContent = "Conectando…";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { errorEl.textContent = "No se pudo obtener la pestaña activa"; btnStart.disabled = false; return; }

  if (activeTab === "create") {
    chrome.runtime.sendMessage(
      { type: "CREATE_ROOM", tabId: tab.id, hostName: name },
      (res: { ok: boolean; code?: string; error?: string } | undefined) => {
        btnStart.disabled = false;
        statusEl.textContent = "";
        if (!res || !res.ok) {
          errorEl.textContent = res?.error ?? "Error al crear sala. Revisa la consola del Service Worker.";
          return;
        }
        showSharingView(res.code!);
      }
    );
  } else {
    chrome.runtime.sendMessage(
      { type: "JOIN_ROOM", tabId: tab.id, code, hostName: name },
      (res: { ok: boolean; error?: string }) => {
        btnStart.disabled = false;
        if (!res.ok) { errorEl.textContent = res.error ?? "Error al unirse"; statusEl.textContent = ""; return; }
        showSharingView(code);
      }
    );
  }
});

// ── Stop ──────────────────────────────────────────────────────────────────────
btnStop.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP_SHARING" }, () => {
    showFormView();
  });
});

// ── Copy link ──────────────────────────────────────────────────────────────────
btnCopy.addEventListener("click", () => {
  navigator.clipboard.writeText(roomLinkEl.value).then(() => {
    btnCopy.textContent = "✓ Copiado";
    setTimeout(() => { btnCopy.textContent = "Copiar"; }, 2000);
  });
});

roomLinkEl.addEventListener("click", () => roomLinkEl.select());

// ── View helpers ──────────────────────────────────────────────────────────────
function showSharingView(code: string) {
  const url = `${__WEB_URL__}/room/${code}`;
  formView.classList.add("hidden");
  sharingView.classList.add("active");
  roomCodeEl.textContent = code;
  roomLinkEl.value = url;
  statusEl.textContent = "✅ Compartiendo";
}

function showFormView() {
  formView.classList.remove("hidden");
  sharingView.classList.remove("active");
  statusEl.textContent = "";
}
