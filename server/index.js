// Small backend for the Client Work Estimator.
//
// Its only job: hold the Productive.io API token server-side (never in the
// frontend bundle, never in Firestore) and create one Productive task per
// quote line-item when someone clicks "Send to Productive" on a Won quote.
//
// SETUP: copy .env.example to .env in this folder and fill in your own
// values. .env is never read by Claude and should stay out of anything
// you share back in chat.

import express from "express";
import fs from "fs";

const PORT = process.env.PORT || 3001;

const PRODUCTIVE_API_TOKEN = process.env.PRODUCTIVE_API_TOKEN || "";
const PRODUCTIVE_ORGANIZATION_ID = process.env.PRODUCTIVE_ORGANIZATION_ID || "";
const PRODUCTIVE_PROJECT_ID = process.env.PRODUCTIVE_PROJECT_ID || "";
const PRODUCTIVE_TASK_LIST_ID = process.env.PRODUCTIVE_TASK_LIST_ID || "";

const isConfigured = Boolean(PRODUCTIVE_API_TOKEN && PRODUCTIVE_ORGANIZATION_ID && PRODUCTIVE_TASK_LIST_ID);

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
      error: "Productive isn't configured on the server yet. Set PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORGANIZATION_ID, and PRODUCTIVE_TASK_LIST_ID in server/.env and restart.",
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
  const title = `${item.task} \u2014 ${context.clientName} (${item.hours}h, ${item.role})`;

  const res = await fetch("https://api.productive.io/api/v2/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.api+json",
      "X-Auth-Token": PRODUCTIVE_API_TOKEN,
      "X-Organization-Id": PRODUCTIVE_ORGANIZATION_ID,
    },
    body: JSON.stringify({
      data: {
        type: "tasks",
        attributes: { title },
        relationships: {
          task_list: {
            data: { type: "task_lists", id: PRODUCTIVE_TASK_LIST_ID },
          },
        },
      },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body && body.errors ? JSON.stringify(body.errors) : `HTTP ${res.status}`;
    throw new Error(`Productive rejected the task: ${detail}`);
  }
  return body && body.data ? body.data.id : null;
}

app.listen(PORT, () => {
  console.log(`Productive bridge listening on :${PORT} (configured: ${isConfigured})`);
});
