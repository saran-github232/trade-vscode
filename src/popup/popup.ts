/** Popup UI: shows the current signal and paper-trading status. */

import { getSignalView } from "../components/ui_client.js";
import { renderSignalCard } from "../components/signal_card.js";

async function init(): Promise<void> {
  const card = document.getElementById("card");
  const status = document.getElementById("status");
  if (!card || !status) return;
  status.textContent = "Analyzing (paper only)…";
  try {
    const view = await getSignalView();
    renderSignalCard(card as HTMLElement, view);
    status.textContent = "Local-first · paper trading · no real-money execution";
  } catch (err) {
    status.textContent = `Error: ${String(err)}`;
  }
}

void init();
