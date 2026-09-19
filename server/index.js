// Small backend for the Client Work Estimator.
//
// Its only job: hold the Productive.io API token server-side (never in the
// frontend bundle, never in Firestore) and create one Productive task per
// quote line-item when someone clicks "Send to Productive" on a Won quote.
//
// SETUP: copy .env.example to .env in this folder and fill in your own
// values. .env is never read by Claude and should stay out of anything
// you share back in chat.
//
// Task list mapping: each quote's project description becomes its own
// Productive task list within PRODUCTIVE_PROJECT_ID — reused if a task
// list with that exact name already exists there, created fresh if not.

import express from "express";

const PORT = process.env.PORT || 3001;

const PRODUCTIVE_API_TOKEN = process.env.PRODUCTIVE_API_TOKEN || "";
const PRODUCTIVE_ORGANIZATION_ID = process.env.PRODUCTIVE_ORGANIZATION_ID || "";
const PRODUCTIVE_PROJECT_ID = process.env.PRODUCTIVE_PROJECT_ID || "";

const isConfigured = Boolean(PRODUCTIVE_API_TOKEN && PRODUCTIVE_ORGANIZATION_ID && PRODUCTIVE_PROJECT_ID);

const app = express();
app.use(express.json());

function productiveHeaders() {
  return {
    "Content-Type": "application/vnd.api+json",
    "X-Auth-Token": PRODUCTIVE_API_TOKEN,
    "X-Organization-Id": PRODUCTIVE_ORGANIZATION_ID,
  };
}

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

  const { quoteId, clientName, projectDescription, items } = req.body || {};
  if (!quoteId || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ ok: false, error: "Request must include quoteId and a non-empty items array." });
  }
  const taskListName = (projectDescription || "").trim() || `${clientName || "Quote"} (no description)`;

  let taskListId;
  try {
    taskListId = await findOrCreateTaskList(taskListName);
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: `Couldn't find or create the task list "${taskListName}" in Productive: ${String(err && err.message ? err.message : err)}`,
    });
  }

  const workflowStatusId = await findWorkflowStatusIdByName("Ready for planning").catch(() => null);

  const results = [];
  for (const item of items) {
    try {
      const productiveTaskId = await createTaskInProductive(item, { clientName, taskListId, workflowStatusId });
      results.push({ task: item.task, ok: true, productiveTaskId });
    } catch (err) {
      results.push({ task: item.task, ok: false, error: String(err && err.message ? err.message : err) });
    }
  }

  const allOk = results.every((r) => r.ok);
  res.status(allOk ? 200 : 207).json({ ok: allOk, quoteId, taskListName, statusApplied: Boolean(workflowStatusId), results });
});

// Looks for an existing task list with this exact name in the configured
// project; creates one if it isn't there yet. Returns the task list's id.
async function findOrCreateTaskList(name) {
  const searchRes = await fetch(
    `https://api.productive.io/api/v2/task_lists?filter[project_id]=${encodeURIComponent(PRODUCTIVE_PROJECT_ID)}&filter[name]=${encodeURIComponent(name)}`,
    { headers: productiveHeaders() }
  );
  const searchBody = await searchRes.json().catch(() => ({}));
  if (searchRes.ok && Array.isArray(searchBody.data)) {
    const existing = searchBody.data.find((tl) => tl.attributes && tl.attributes.name === name);
    if (existing) return existing.id;
  }

  const createRes = await fetch("https://api.productive.io/api/v2/task_lists", {
    method: "POST",
    headers: productiveHeaders(),
    body: JSON.stringify({
      data: {
        type: "task_lists",
        attributes: { name, project_id: PRODUCTIVE_PROJECT_ID },
      },
    }),
  });
  const createBody = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    const detail = createBody && createBody.errors ? JSON.stringify(createBody.errors) : `HTTP ${createRes.status}`;
    throw new Error(detail);
  }
  return createBody.data.id;
}

// Looks up the id of a workflow status by name (e.g. "Ready for planning")
// within the configured project. Returns null if not found, rather than
// throwing — a missing/renamed status shouldn't block task creation
// entirely, it'll just leave the task on Productive's default status.
async function findWorkflowStatusIdByName(name) {
  const res = await fetch(
    `https://api.productive.io/api/v2/workflow_statuses?filter[project_id]=${encodeURIComponent(PRODUCTIVE_PROJECT_ID)}&filter[name]=${encodeURIComponent(name)}`,
    { headers: productiveHeaders() }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(body.data)) return null;
  const match = body.data.find((s) => s.attributes && s.attributes.name === name);
  return match ? match.id : null;
}

async function createTaskInProductive(item, context) {
  // item: { task, category, role, hours, qty, notes }
  // context: { clientName, taskListId }
  const title = item.task;
  const description = item.notes || "";
  const initialEstimate = Math.round((Number(item.hours) || 0) * 60); // Productive tracks estimates in minutes
  const tagList = [context.clientName, item.category, item.role].filter(Boolean).join(", ");

  const res = await fetch("https://api.productive.io/api/v2/tasks", {
    method: "POST",
    headers: productiveHeaders(),
    body: JSON.stringify({
      data: {
        type: "tasks",
        attributes: { title, description, initial_estimate: initialEstimate, project_id: PRODUCTIVE_PROJECT_ID, tag_list: tagList, private: true },
        relationships: {
          task_list: {
            data: { type: "task_lists", id: context.taskListId },
          },
          ...(context.workflowStatusId ? {
            workflow_status: {
              data: { type: "workflow_statuses", id: context.workflowStatusId },
            },
          } : {}),
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
