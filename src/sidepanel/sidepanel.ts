/** Sidepanel UI: fuller analysis view with refresh. */

import { getSignalView } from "../components/ui_client.js";
import { renderSignalCard } from "../components/signal_card.js";

async function refresh(): Promise<void> {
  const card = document.getElementById("card");
  const status = document.getElementById("status");
  if (!card || !status) return;
  status.textContent = "Analyzing (paper only)…";
  try {
    const view = await getSignalView();
    renderSignalCard(card as HTMLElement, view);
    status.textContent = `${view.direction} · conviction ${(view.confidence * 100).toFixed(1)}% (not a probability)`;
  } catch (err) {
    status.textContent = `Error: ${String(err)}`;
  }
}

function init(): void {
  document.getElementById("refresh")?.addEventListener("click", () => void refresh());
  void refresh();
}

void init();
