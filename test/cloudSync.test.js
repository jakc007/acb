import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceSync, createCloudApi, migrateWorkspace, stableStringify } from "../src/lib/cloudSync.js";

const workspace = (name = "A") => ({ packages: [], draft: { items: [], packageName: name } });
function server() {
  let row = { revision: 0, data: null };
  return {
    read: async () => structuredClone(row),
    write: async (revision, data) => {
      if (revision !== row.revision) return null;
      row = { revision: revision + 1, data: structuredClone(data) };
      return { revision: row.revision };
    },
  };
}
function device(api, initialCache = null) {
  let saved = initialCache, visible, status;
  const engine = new WorkspaceSync({ api,
    cache: { read: () => saved, write: (value) => { saved = structuredClone(value); } },
    onData: (value) => { visible = value; }, onStatus: (value) => { status = value; }, makeId: () => "copy",
  });
  return { engine, cache: () => saved, visible: () => visible, status: () => status };
}

test("automatically creates cloud workspace and refreshes a second device", async () => {
  const api = server(), a = device(api), b = device(api);
  await a.engine.start(workspace()); await b.engine.start(workspace());
  a.engine.change(workspace("Changed")); await a.engine.sync(); await b.engine.sync();
  assert.equal(b.visible().draft.packageName, "Changed");
  assert.equal(b.status(), "saved");
});

test("concurrent edits keep local changes and reject stale writes", async () => {
  const api = server(), a = device(api), b = device(api);
  await a.engine.start(workspace()); await b.engine.start(workspace());
  a.engine.change(workspace("A edits")); b.engine.change(workspace("B edits"));
  await a.engine.sync(); await b.engine.sync();
  assert.equal(b.status(), "conflict");
  assert.equal(b.cache().data.draft.packageName, "B edits");
  assert.equal((await api.read()).data.draft.packageName, "A edits");
  await b.engine.useCloud();
  assert.equal(b.visible().draft.packageName, "A edits");
});

test("offline edits survive reload, then retry automatically", async () => {
  const api = server(), a = device(api);
  await a.engine.start(workspace());
  a.engine.change(workspace("Offline"));
  const write = api.write;
  api.write = async () => { throw new Error("Offline"); };
  await a.engine.sync();
  assert.equal(a.status(), "offline"); assert.equal(a.cache().pending, true);
  api.write = write;
  const b = device(api, a.cache()); await b.engine.start(workspace());
  assert.equal((await api.read()).data.draft.packageName, "Offline");
  assert.equal(b.cache().pending, false);
});

test("pending cache on a stale device is preserved across reload", async () => {
  const api = server(), a = device(api), b = device(api);
  await a.engine.start(workspace()); await b.engine.start(workspace());
  b.engine.change(workspace("Pending"));
  a.engine.change(workspace("New cloud")); await a.engine.sync();
  const reloaded = device(api, b.cache()); await reloaded.engine.start(workspace());
  assert.equal(reloaded.status(), "conflict");
  assert.equal(reloaded.visible().draft.packageName, "Pending");
});

test("a first-time device remains editable when its first cloud request fails", async () => {
  let writes = 0;
  const api = { read: async () => { throw new TypeError("Failed to fetch"); }, write: async () => { writes++; } };
  const a = device(api);
  await a.engine.start(workspace());
  assert.equal(a.engine.ready, true);
  assert.equal(a.status(), "offline");
  assert.deepEqual(a.visible(), workspace());
  a.engine.change(workspace("Nov lokalni osnutek"));
  assert.equal(a.cache().data.draft.packageName, "Nov lokalni osnutek");
  assert.equal(a.cache().unverified, true);
  await a.engine.sync();
  assert.equal(writes, 0);
});

test("offline first-run cache survives reload and merges cloud packages before writing", async () => {
  const api = server();
  const remote = { packages: [{ id: "cloud", name: "Cloud package" }], draft: { items: [{ artikel: "Oblačni artikel" }] } };
  await api.write(0, remote);
  const read = api.read;
  api.read = async () => { throw new TypeError("Failed to fetch"); };
  const a = device(api); await a.engine.start(workspace());
  const local = { packages: [{ id: "local", name: "Local package" }], draft: { items: [{ artikel: "Lokalni artikel" }] } };
  a.engine.change(local);
  const b = device(api, a.cache()); await b.engine.start(workspace());
  assert.equal(b.engine.ready, true);
  assert.deepEqual(b.visible(), local);
  api.read = read;
  await b.engine.sync();
  const saved = (await api.read()).data;
  assert.equal(saved.packages.find((pkg) => pkg.id === "cloud").name, "Cloud package");
  assert.equal(saved.packages.find((pkg) => pkg.id === "local").name, "Local package");
  assert.equal(saved.packages.find((pkg) => pkg.name === "Ohranjen osnutek iz oblaka").items[0].artikel, "Oblačni artikel");
  assert.equal(saved.draft.items[0].artikel, "Lokalni artikel");
  assert.equal(b.status(), "saved");
  assert.equal(b.cache().unverified, false);
});

test("reloading a first-run offline cache after reconnect also preserves both drafts", async () => {
  const api = server();
  const remote = { packages: [{ id: "existing" }], draft: { items: [{ artikel: "Remote" }] } };
  await api.write(0, remote);
  const local = { packages: [{ id: "offline" }], draft: { items: [{ artikel: "Local" }] } };
  const a = device(api, { revision: 0, data: local, pending: true, unverified: true });
  await a.engine.start(workspace());
  const saved = (await api.read()).data;
  assert.equal(saved.draft.items[0].artikel, "Local");
  assert.equal(saved.packages.length, 3);
  assert.equal(a.status(), "saved");
});

test("typing during first reconnect is merged using the latest local input", async () => {
  const api = server();
  await api.write(0, { packages: [{ id: "remote" }], draft: { items: [] } });
  const read = api.read;
  api.read = async () => { throw new TypeError("Failed to fetch"); };
  const a = device(api); await a.engine.start(workspace());
  let release;
  api.read = () => new Promise((resolve) => { release = async () => resolve(await read()); });
  const syncing = a.engine.sync();
  a.engine.change(workspace("Typed while reconnecting"));
  await release(); await syncing;
  const saved = await read();
  assert.equal(saved.data.draft.packageName, "Typed while reconnecting");
  assert.equal(saved.data.packages[0].id, "remote");
  assert.equal(a.status(), "saved");
});

test("cached devices remain editable offline and stale changes still require a conflict", async () => {
  const api = server(), a = device(api), b = device(api);
  await a.engine.start(workspace()); await b.engine.start(workspace());
  const cached = b.cache();
  a.engine.change(workspace("Other device")); await a.engine.sync();
  const read = api.read;
  api.read = async () => { throw new TypeError("Failed to fetch"); };
  const reloaded = device(api, cached); await reloaded.engine.start(workspace());
  assert.equal(reloaded.engine.ready, true);
  reloaded.engine.change(workspace("Cached offline edits"));
  assert.equal(reloaded.cache().unverified, false);
  api.read = read; await reloaded.engine.sync();
  assert.equal(reloaded.status(), "conflict");
  assert.equal((await api.read()).data.draft.packageName, "Other device");
  assert.equal(reloaded.cache().data.draft.packageName, "Cached offline edits");
});

test("a new offline device with no edits adopts the cloud draft on reconnect", async () => {
  const api = server();
  await api.write(0, workspace("Existing cloud draft"));
  const read = api.read;
  api.read = async () => { throw new TypeError("Failed to fetch"); };
  const a = device(api); await a.engine.start(workspace());
  api.read = read; await a.engine.sync();
  assert.equal(a.visible().draft.packageName, "Existing cloud draft");
  assert.equal((await api.read()).revision, 1);
});

test("offline package collisions keep the editor pointing to the local copy", () => {
  const local = { packages: [{ id: "p", name: "Local" }], draft: { items: [], editingPackageId: "p", packageName: "Local" } };
  const remote = { packages: [{ id: "p", name: "Remote" }], draft: { items: [] } };
  const merged = migrateWorkspace(local, remote, () => "local-copy", { preferLocalDraft: true });
  assert.equal(merged.packages.find((pkg) => pkg.id === "p").name, "Remote");
  assert.equal(merged.draft.editingPackageId, "local-copy");
  assert.equal(merged.draft.packageName, "Local – lokalna kopija");
});

test("network failures give an actionable explanation instead of Failed to fetch", async () => {
  const api = createCloudApi({ url: "https://test.supabase.co", key: "public", getToken: async () => "token", fetcher: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(api.read(), /Resume project/);
});

test("a failed conflict reload still allows another cloud reload", async () => {
  const api = server(), a = device(api), b = device(api);
  await a.engine.start(workspace()); await b.engine.start(workspace());
  a.engine.change(workspace("Remote")); b.engine.change(workspace("Local"));
  await a.engine.sync(); await b.engine.sync();
  const read = api.read;
  api.read = async () => { throw new Error("Offline"); };
  await b.engine.useCloud();
  assert.equal(b.status(), "conflict");
  assert.equal(b.cache().data.draft.packageName, "Local");
  api.read = read; await b.engine.useCloud();
  assert.equal(b.status(), "saved");
});

test("typing during a cloud read is never overwritten", async () => {
  const api = server(), a = device(api), b = device(api);
  await a.engine.start(workspace()); await b.engine.start(workspace());
  a.engine.change(workspace("Remote")); await a.engine.sync();
  const read = api.read;
  let release;
  api.read = () => new Promise((resolve) => { release = async () => resolve(await read()); });
  const syncing = b.engine.sync();
  b.engine.change(workspace("Typing")); await release(); await syncing;
  assert.equal(b.status(), "conflict");
  assert.equal(b.cache().data.draft.packageName, "Typing");
});

test("typing during a write stays pending and uses the new revision", async () => {
  const api = server(), a = device(api);
  await a.engine.start(workspace());
  const write = api.write; let release;
  api.write = (...args) => new Promise((resolve) => { release = async () => resolve(await write(...args)); });
  a.engine.change(workspace("First")); const syncing = a.engine.sync();
  a.engine.change(workspace("Second")); await release(); await syncing;
  assert.equal(a.cache().pending, true);
  api.write = write; await a.engine.sync();
  assert.equal((await api.read()).data.draft.packageName, "Second");
});

test("lost response retries without creating a false conflict", async () => {
  const api = server(), a = device(api);
  await a.engine.start(workspace());
  const write = api.write;
  api.write = async (...args) => { await write(...args); throw new Error("lost response"); };
  a.engine.change(workspace("Committed")); await a.engine.sync();
  api.write = write; await a.engine.sync();
  assert.equal(a.status(), "saved"); assert.equal(a.cache().pending, false);
});

test("stopping an instance ignores responses from the previous account", async () => {
  const api = server(), a = device(api);
  let release; api.read = () => new Promise((resolve) => { release = resolve; });
  const starting = a.engine.start(workspace()); a.engine.stop();
  release({ revision: 1, data: workspace("Other account") }); await starting;
  assert.equal(a.visible(), undefined); assert.equal(a.cache(), null);
});

test("migration preserves colliding local packages and meaningful draft as copies", () => {
  const local = { packages: [{ id: "p", name: "Local" }], draft: { items: [{ artikel: "Majica" }] } };
  const remote = { packages: [{ id: "p", name: "Cloud" }], draft: { items: [] } };
  let id = 0;
  const result = migrateWorkspace(local, remote, () => `copy-${++id}`);
  assert.equal(result.packages.length, 3);
  assert.equal(result.packages[0].name, "Cloud");
  assert.equal(result.packages[1].name, "Local – lokalna kopija");
  assert.equal(result.packages[2].items[0].artikel, "Majica");
  assert.deepEqual(result.draft, remote.draft);
});

test("JSONB property ordering does not cause false changes", () => {
  assert.equal(stableStringify({ a: 1, b: { c: 2, d: 3 } }), stableStringify({ b: { d: 3, c: 2 }, a: 1 }));
});

test("API uses a fresh Clerk token, public API key, and atomic revision", async () => {
  const requests = []; let token = 0;
  const api = createCloudApi({ url: "https://example.supabase.co/", key: "public", getToken: async () => `token-${++token}`,
    fetcher: async (url, options) => { requests.push({ url, ...options }); return { ok: true, json: async () => [] }; },
  });
  assert.deepEqual(await api.read(), { revision: 0, data: null });
  assert.equal(await api.write(3, workspace()), null);
  assert.equal(requests[0].headers.Authorization, "Bearer token-1");
  assert.equal(requests[1].headers.Authorization, "Bearer token-2");
  assert.equal(requests[1].headers.apikey, "public");
  assert.equal(JSON.parse(requests[1].body).expected_revision, 3);
});

test("unauthenticated and failed requests cannot be reported as saved", async () => {
  const unauthenticated = createCloudApi({ url: "https://example.supabase.co", key: "public", getToken: async () => null });
  await assert.rejects(unauthenticated.read(), /prijavi/);
  const denied = createCloudApi({ url: "https://example.supabase.co", key: "public", getToken: async () => "token", fetcher: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(denied.write(0, workspace()), /403/);
});
