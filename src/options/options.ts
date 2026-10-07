/** Options page: configuration display + secure API-key storage. */

import { loadConfig } from "../config/config.js";
import { getSignalView } from "../components/ui_client.js";
import { renderSignalCard } from "../components/signal_card.js";

async function sendMessage(msg: Record<string, unknown>): Promise<unknown> {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    return chrome.runtime.sendMessage(msg);
  }
  return { type: "ERROR", message: "Background worker unavailable." };
}

async function refreshSecrets(): Promise<void> {
  const list = document.getElementById("secrets");
  if (!list) return;
  const resp = (await sendMessage({ type: "LIST_SECRETS" })) as { type: string; items?: { name: string; masked: string }[] };
  list.replaceChildren();
  if (resp && resp.type === "SECRETS" && resp.items) {
    for (const it of resp.items) {
      const li = document.createElement("li");
      li.textContent = `${it.name}: ${it.masked}`;
      list.appendChild(li);
    }
  }
}

async function init(): Promise<void> {
  const cfgEl = document.getElementById("config");
  if (cfgEl) {
    const cfg = loadConfig();
    cfgEl.textContent = JSON.stringify(cfg, null, 2);
  }

  document.getElementById("save-key")?.addEventListener("click", () => {
    const name = (document.getElementById("key-name") as HTMLInputElement | null)?.value ?? "";
    const apiKey = (document.getElementById("key-value") as HTMLInputElement | null)?.value ?? "";
    if (!name || !apiKey) return;
    void sendMessage({ type: "SAVE_API_KEY", name, apiKey }).then(() => {
      const kv = document.getElementById("key-value") as HTMLInputElement | null;
      if (kv) kv.value = ""; // clear plaintext from the field
      void refreshSecrets();
    });
  });

  document.getElementById("analyze")?.addEventListener("click", () => {
    void (async () => {
      const card = document.getElementById("card");
      if (!card) return;
      const view = await getSignalView();
      renderSignalCard(card, view);
    })();
  });

  await refreshSecrets();
}

void init();
