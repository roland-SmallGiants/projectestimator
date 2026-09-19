// Small backend for the Client Work Estimator.
//
// Its only job right now: hold the Productive.io API token server-side
// (never in the frontend bundle, never in Firestore) and create one
// Productive task per quote line-item when someone clicks "Send to
// Productive" on a Won quote.
//
// SETUP: copy .env.example to .env in this folder and fill in your own
// values. .env is never read by Claude and should stay out of anything
// you share back in chat.
//
// STATUS: the actual call to Productive's API (createTaskInProductive
// below) is a placeholder until we have Productive's current API docs
// in hand. Everything else here — env loading, validation, batching,
// error handling, the response shape the frontend expects — is real
// and shouldn't need to change once that part is filled in.

import express from "express";
import fs from "fs";

const PORT = process.env.PORT || 3001;

const PRODUCTIVE_API_TOKEN = process.env.PRODUCTIVE_API_TOKEN || "";
const PRODUCTIVE_ORGANIZATION_ID = process.env.PRODUCTIVE_ORGANIZATION_ID || "";
const PRODUCTIVE_PROJECT_ID = process.env.PRODUCTIVE_PROJECT_ID || "";
const PRODUCTIVE_TASK_LIST_ID = process.env.PRODUCTIVE_TASK_LIST_ID || "";

const isConfigured = Boolean(PRODUCTIVE_API_TOKEN && PRODUCTIVE_ORGANIZATION_ID && PRODUCTIVE_PROJECT_ID);

const app = express();
app.use(express.json());

app.get("/api/productive/status", (req, res) => {
  // Lets the frontend show "not configured yet" instead of a confusing
  // failure, without ever revealing the actual token/IDs.
  res.json({ configured: isConfigured });
});

app.post("/api/productive/create-tasks", async (req, res) => {
  if (!isConfigured) {
    return res.status(400).json({
      ok: false,
      error: "Productive isn't configured on the server yet. Set PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORGANIZATION_ID, and PRODUCTIVE_PROJECT_ID in server/.env and restart.",
    });
  }

  const { quoteId, clientName, items } = req.body || {};
  if (!quoteId || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ ok: false, error: "Request must include quoteId and a non-empty items array." });
  }

  const results = [];
  for (const item of items) {
    try {
      const productiveTaskId = await createTaskInProductive(item, { clientName });
      results.push({ task: item.task, ok: true, productiveTaskId });
    } catch (err) {
      results.push({ task: item.task, ok: false, error: String(err && err.message ? err.message : err) });
    }
  }

  const allOk = results.every((r) => r.ok);
  res.status(allOk ? 200 : 207).json({ ok: allOk, quoteId, results });
});

// --- Placeholder: fill this in once we have Productive's real API docs ---
async function createTaskInProductive(item, context) {
  // item: { task, category, role, hours, qty, notes }
  // context: { clientName }
  //
  // Expected to end up looking roughly like a fetch() to Productive's
  // tasks endpoint, authenticated with PRODUCTIVE_API_TOKEN and scoped to
  // PRODUCTIVE_ORGANIZATION_ID / PRODUCTIVE_PROJECT_ID / PRODUCTIVE_TASK_LIST_ID,
  // returning the created task's id.
  //
  // Left unimplemented on purpose — throwing here so it's obvious in the
  // response which tasks were (not) actually created, rather than silently
  // pretending to succeed.
  throw new Error("Productive API call not implemented yet — waiting on API docs.");
}

app.listen(PORT, () => {
  console.log(`Productive bridge listening on :${PORT} (configured: ${isConfigured})`);
});
