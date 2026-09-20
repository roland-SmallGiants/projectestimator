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
const PRODUCTIVE_FOLDER_ID = process.env.PRODUCTIVE_FOLDER_ID || "";

const isConfigured = Boolean(PRODUCTIVE_API_TOKEN && PRODUCTIVE_ORGANIZATION_ID && PRODUCTIVE_PROJECT_ID && PRODUCTIVE_FOLDER_ID);

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

// Temporary helper: proves definitively which code version is actually
// running, so we stop guessing whether a deploy really happened.
app.get("/api/productive/debug/version", (req, res) => {
  res.json({ version: "documented-format-fix-2026-09-20-parent-task-id-as-attribute" });
});

// Temporary helper: lists folders in the configured project so we can find
// the right PRODUCTIVE_FOLDER_ID without digging through Productive's UI.
// Safe to remove once that's set — it only reveals folder names/ids, not
// the token or anything else sensitive.
app.get("/api/productive/debug/folders", async (req, res) => {
  if (!PRODUCTIVE_API_TOKEN || !PRODUCTIVE_ORGANIZATION_ID || !PRODUCTIVE_PROJECT_ID) {
    return res.status(400).json({ ok: false, error: "PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORGANIZATION_ID, and PRODUCTIVE_PROJECT_ID must all be set first." });
  }
  try {
    const r = await fetch(
      `https://api.productive.io/api/v2/folders?filter[project_id]=${encodeURIComponent(PRODUCTIVE_PROJECT_ID)}`,
      { headers: productiveHeaders() }
    );
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ ok: false, error: body });
    const folders = (body.data || []).map((f) => ({ id: f.id, name: f.attributes && f.attributes.name }));
    res.json({ ok: true, folders });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

// Temporary helper: creates a dedicated folder (default name "Imported from
// Estimator") in the configured project, so tasks sent from this app land
// somewhere clearly labeled instead of a generic folder. Pass ?name=... to
// use a different name. Safe to remove once PRODUCTIVE_FOLDER_ID is set.
app.post("/api/productive/debug/create-folder", async (req, res) => {
  if (!PRODUCTIVE_API_TOKEN || !PRODUCTIVE_ORGANIZATION_ID || !PRODUCTIVE_PROJECT_ID) {
    return res.status(400).json({ ok: false, error: "PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORGANIZATION_ID, and PRODUCTIVE_PROJECT_ID must all be set first." });
  }
  const name = (req.query.name || "Imported from Estimator").toString();
  try {
    const r = await fetch("https://api.productive.io/api/v2/folders", {
      method: "POST",
      headers: productiveHeaders(),
      body: JSON.stringify({
        data: { type: "folders", attributes: { name, project_id: PRODUCTIVE_PROJECT_ID } },
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ ok: false, error: body });
    res.json({ ok: true, id: body.data.id, name: body.data.attributes && body.data.attributes.name });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

// Temporary helper: fetches one task's full raw JSON:API response, so we
// can see exactly what Productive stored (e.g. whether tag_list actually
// took effect) instead of guessing from the UI.
app.get("/api/productive/debug/task/:id", async (req, res) => {
  try {
    const r = await fetch(`https://api.productive.io/api/v2/tasks/${encodeURIComponent(req.params.id)}?include=parent_task`, {
      headers: productiveHeaders(),
    });
    const body = await r.json().catch(() => ({}));
    res.status(r.status).json(body);
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

// Temporary helper: creates a NON-private test task with a test tag_list,
// then immediately reads it back. Isolates whether tag_list works at all
// from the separate issue of private tasks being unreadable via this token.
app.post("/api/productive/debug/tag-test", async (req, res) => {
  if (!isConfigured) return res.status(400).json({ ok: false, error: "Not configured yet." });
  try {
    const taskListId = await findOrCreateTaskList("Tag test (safe to delete)");
    const createRes = await fetch("https://api.productive.io/api/v2/tasks", {
      method: "POST",
      headers: productiveHeaders(),
      body: JSON.stringify({
        data: {
          type: "tasks",
          attributes: {
            title: "Tag test task",
            project_id: PRODUCTIVE_PROJECT_ID,
            tag_list: ["test-client", "test-discipline", "test-role"],
            private: false,
          },
          relationships: { task_list: { data: { type: "task_lists", id: taskListId } } },
        },
      }),
    });
    const createBody = await createRes.json().catch(() => ({}));
    if (!createRes.ok) return res.status(502).json({ ok: false, step: "create", error: createBody });

    const taskId = createBody.data.id;
    const readRes = await fetch(`https://api.productive.io/api/v2/tasks/${taskId}`, { headers: productiveHeaders() });
    const readBody = await readRes.json().catch(() => ({}));
    res.json({ ok: true, taskId, createdAttributes: createBody.data.attributes, readBackAttributes: readBody.data && readBody.data.attributes });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

// Temporary helper: creates one parent task, then tries several different
// ways of linking a subtask to it (string id vs number id, attribute vs
// relationship, a couple of plausible field names) so we can see which one
// Productive actually accepts, in a single deploy instead of many.
app.post("/api/productive/debug/parent-task-test", async (req, res) => {
  if (!isConfigured) return res.status(400).json({ ok: false, error: "Not configured yet." });
  try {
    const taskListId = await findOrCreateTaskList("Parent task test (safe to delete)");
    const parentRes = await fetch("https://api.productive.io/api/v2/tasks", {
      method: "POST",
      headers: productiveHeaders(),
      body: JSON.stringify({
        data: {
          type: "tasks",
          attributes: { title: "Parent task test", project_id: PRODUCTIVE_PROJECT_ID, private: true },
          relationships: { task_list: { data: { type: "task_lists", id: taskListId } } },
        },
      }),
    });
    const parentBody = await parentRes.json().catch(() => ({}));
    if (!parentRes.ok) return res.status(502).json({ ok: false, step: "create parent", error: parentBody });
    const parentId = parentBody.data.id;

    const attempts = [
      { label: "parent_task_id as string attribute", body: { attributes: { title: "Attempt: parent_task_id string", project_id: PRODUCTIVE_PROJECT_ID, parent_task_id: parentId } } },
      { label: "parent_task_id as number attribute", body: { attributes: { title: "Attempt: parent_task_id number", project_id: PRODUCTIVE_PROJECT_ID, parent_task_id: Number(parentId) } } },
      { label: "relationships.parent_task with number id", body: { attributes: { title: "Attempt: relationship number", project_id: PRODUCTIVE_PROJECT_ID }, relationships: { parent_task: { data: { type: "tasks", id: Number(parentId) } } } } },
      { label: "relationships.parent (no _task) with string id", body: { attributes: { title: "Attempt: relationship parent", project_id: PRODUCTIVE_PROJECT_ID }, relationships: { parent: { data: { type: "tasks", id: parentId } } } } },
      { label: "relationships.parent_task with STRING id (original)", body: { attributes: { title: "Attempt: relationship parent_task string", project_id: PRODUCTIVE_PROJECT_ID }, relationships: { parent_task: { data: { type: "tasks", id: parentId } } } } },
      { label: "relationships.parent_task, type 'task' singular, string id", body: { attributes: { title: "Attempt: singular type", project_id: PRODUCTIVE_PROJECT_ID }, relationships: { parent_task: { data: { type: "task", id: parentId } } } } },
    ];

    const attemptResults = [];
    for (const attempt of attempts) {
      const r = await fetch("https://api.productive.io/api/v2/tasks", {
        method: "POST",
        headers: productiveHeaders(),
        body: JSON.stringify({
          data: {
            type: "tasks",
            ...attempt.body,
            relationships: { ...(attempt.body.relationships || {}), task_list: { data: { type: "task_lists", id: taskListId } } },
          },
        }),
      });
      const body = await r.json().catch(() => ({}));
      let readBack = null;
      if (r.ok) {
        const verifyRes = await fetch(`https://api.productive.io/api/v2/tasks/${body.data.id}?include=parent_task`, { headers: productiveHeaders() });
        const verifyBody = await verifyRes.json().catch(() => ({}));
        readBack = {
          parentTaskRelationship: verifyBody.data && verifyBody.data.relationships && verifyBody.data.relationships.parent_task,
          included: verifyBody.included || [],
        };
      }
      attemptResults.push({ label: attempt.label, ok: r.ok, result: r.ok ? { id: body.data.id } : body, readBack });
    }

    // Also try a dedicated nested endpoint, in case Productive expects
    // subtasks to be created there rather than via a field on /tasks.
    let dedicatedEndpointResult;
    try {
      const dedicatedRes = await fetch(`https://api.productive.io/api/v2/tasks/${parentId}/subtasks`, {
        method: "POST",
        headers: productiveHeaders(),
        body: JSON.stringify({
          data: { type: "tasks", attributes: { title: "Attempt: dedicated subtask endpoint", project_id: PRODUCTIVE_PROJECT_ID } },
        }),
      });
      const dedicatedBody = await dedicatedRes.json().catch(() => ({}));
      dedicatedEndpointResult = { httpStatus: dedicatedRes.status, ok: dedicatedRes.ok, body: dedicatedBody };
    } catch (err) {
      dedicatedEndpointResult = { error: String(err && err.message ? err.message : err) };
    }

    res.json({ ok: true, parentId, attempts: attemptResults, dedicatedEndpointResult });
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

app.post("/api/productive/create-tasks", async (req, res) => {
  if (!isConfigured) {
    return res.status(400).json({
      ok: false,
      error: "Productive isn't configured on the server yet. Set PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORGANIZATION_ID, PRODUCTIVE_PROJECT_ID, and PRODUCTIVE_FOLDER_ID in server/.env and restart.",
    });
  }

  const { quoteId, clientName, projectDescription, items } = req.body || {};
  if (!quoteId || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ ok: false, error: "Request must include quoteId and a non-empty items array." });
  }
  const desc = (projectDescription || "").trim();
  const taskListName = desc ? `${clientName || "Unknown client"} \u2014 ${desc}` : (clientName || "Quote");

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

  // Group line items by discipline: each discipline becomes one parent task,
  // and each of its line items becomes a subtask underneath that task.
  const byDiscipline = new Map();
  items.forEach((item) => {
    const key = item.category || "General";
    if (!byDiscipline.has(key)) byDiscipline.set(key, []);
    byDiscipline.get(key).push(item);
  });

  const results = [];
  for (const [discipline, disciplineItems] of byDiscipline) {
    const totalHours = disciplineItems.reduce((s, it) => s + (Number(it.hours) || 0), 0);
    let parentTaskId;
    try {
      parentTaskId = await createTaskInProductive(
        { task: discipline, category: discipline, hours: totalHours, notes: "" },
        { clientName, taskListId, workflowStatusId }
      );
      results.push({ task: discipline, ok: true, productiveTaskId: parentTaskId, isParent: true });
    } catch (err) {
      results.push({ task: discipline, ok: false, error: String(err && err.message ? err.message : err), isParent: true });
      // Can't create subtasks without a parent — mark each of this
      // discipline's items as failed too, rather than silently skipping them.
      disciplineItems.forEach((item) => {
        results.push({ task: item.task, ok: false, error: `Skipped: parent task "${discipline}" failed to create.` });
      });
      continue;
    }

    for (const item of disciplineItems) {
      try {
        const productiveTaskId = await createTaskInProductive(item, { clientName, taskListId, workflowStatusId, parentTaskId });
        results.push({ task: item.task, ok: true, productiveTaskId });
      } catch (err) {
        results.push({ task: item.task, ok: false, error: String(err && err.message ? err.message : err) });
      }
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
        attributes: { name, project_id: PRODUCTIVE_PROJECT_ID, folder_id: PRODUCTIVE_FOLDER_ID },
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
  // context: { clientName, taskListId, workflowStatusId, parentTaskId? }
  const title = item.task;
  const description = item.notes || "";
  const initialEstimate = Math.round((Number(item.hours) || 0) * 60); // Productive tracks estimates in minutes
  const tagList = [context.clientName, item.category, item.role].filter(Boolean);

  // Per Productive's docs, every foreign-key-style field (project, task list,
  // workflow status, parent task) is a plain "_id" attribute, NOT a JSON:API
  // relationship, despite the general JSON:API convention suggesting otherwise.
  const res = await fetch("https://api.productive.io/api/v2/tasks", {
    method: "POST",
    headers: productiveHeaders(),
    body: JSON.stringify({
      data: {
        type: "tasks",
        attributes: {
          title,
          description,
          initial_estimate: initialEstimate,
          project_id: Number(PRODUCTIVE_PROJECT_ID),
          task_list_id: Number(context.taskListId),
          tag_list: tagList,
          ...(context.workflowStatusId ? { workflow_status_id: Number(context.workflowStatusId) } : {}),
          ...(context.parentTaskId ? { parent_task_id: Number(context.parentTaskId) } : { private: true }),
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
