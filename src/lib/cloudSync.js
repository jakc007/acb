// A revision belongs to the complete workspace. The server rejects stale writes.
export function createCloudApi({ url, key, getToken, fetcher = fetch }) {
  async function request(path, options = {}) {
    const token = await getToken();
    if (!token) throw new Error("Za sinhronizacijo se ponovno prijavi.");
    const response = await fetcher(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
      ...options,
      headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Oblak ni dosegljiv (${response.status}). Preveri povezavo in nastavitev Supabase.`);
    return response.json();
  }
  return {
    async read() {
      const rows = await request("acb_workspaces?select=revision,data");
      return rows[0] || { revision: 0, data: null };
    },
    async write(revision, data) {
      const rows = await request("rpc/save_acb_workspace", {
        method: "POST", body: JSON.stringify({ expected_revision: revision, workspace_data: data }),
      });
      return rows[0] || null;
    },
  };
}

export function snapshotWorkspace(packages, draft) {
  return JSON.parse(JSON.stringify({
    packages: packages.map(({ derived, ...pkg }) => pkg), draft,
  }));
}

export function stableStringify(value) {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
}
const same = (a, b) => stableStringify(a) === stableStringify(b);

export function migrateWorkspace(local, remote, makeId) {
  if (!remote) return local;
  const packages = [...remote.packages];
  const ids = new Set(packages.map((pkg) => pkg.id));
  for (const pkg of local.packages) {
    if (!ids.has(pkg.id)) { packages.push(pkg); ids.add(pkg.id); }
    else if (!same(packages.find((p) => p.id === pkg.id), pkg)) {
      packages.push({ ...pkg, id: makeId(), name: `${pkg.name} – lokalna kopija` });
    }
  }
  if (local.draft.items?.some((item) => item.artikel?.trim() || Number(item.cny) || Number(item.weight)) && !same(local.draft, remote.draft)) {
    const now = new Date().toISOString();
    packages.push({ ...local.draft, id: makeId(), name: "Uvožen osnutek s te naprave", createdAt: now, updatedAt: now });
  }
  return { packages, draft: remote.draft };
}

export class WorkspaceSync {
  constructor({ api, cache, onData, onStatus, makeId }) {
    Object.assign(this, { api, cache, onData, onStatus, makeId });
    this.revision = 0;
    this.pending = false;
    this.ready = false;
    this.stopped = false;
  }
  persist() {
    this.cache.write({ revision: this.revision, data: this.data, pending: this.pending });
  }
  async start(local) {
    this.local = local;
    if (this.busy || this.stopped) return;
    this.busy = true;
    this.onStatus("loading");
    try {
      const cached = this.cache.read();
      const remote = await this.api.read();
      if (this.stopped) return;
      this.revision = cached?.pending ? cached.revision : remote.revision;
      this.data = cached?.pending ? cached.data : cached ? remote.data || cached.data : migrateWorkspace(local, remote.data, this.makeId);
      this.pending = !same(this.data, remote.data);
      this.conflict = !!(cached?.pending && cached.revision !== remote.revision && this.pending);
      if (!this.pending) this.revision = remote.revision;
      this.persist();
      this.ready = true;
      this.onData(this.data);
      this.onStatus(this.conflict ? "conflict" : this.pending ? "pending" : "saved");
    } catch (error) {
      if (!this.stopped) this.onStatus("error", error.message);
    } finally { this.busy = false; }
    if (this.ready && !this.conflict) await this.sync();
  }
  change(data) {
    if (!this.ready || this.stopped || same(this.data, data)) return;
    this.data = data;
    this.pending = true;
    try { this.persist(); }
    catch { this.onStatus("error", "Lokalna varnostna kopija ni uspela. Izvozi JSON pred zapiranjem."); return; }
    this.onStatus(this.conflict ? "conflict" : "pending");
  }
  async sync() {
    if (this.stopped || this.busy || this.conflict) return;
    if (!this.ready) return this.start(this.local);
    this.busy = true;
    try {
      if (this.pending) {
        const sent = this.data;
        this.onStatus("saving");
        const result = await this.api.write(this.revision, sent);
        if (this.stopped) return;
        if (!result) {
          const remote = await this.api.read();
          if (this.stopped) return;
          // A response can be lost after a successful commit. A retry is safe.
          if (!same(remote.data, sent)) {
            this.conflict = true;
            this.onStatus("conflict");
            return;
          }
          this.revision = remote.revision;
        } else this.revision = result.revision;
        this.pending = !same(sent, this.data);
        this.persist();
      } else {
        const remote = await this.api.read();
        if (this.stopped) return;
        // A user may type while the read is in flight. Never replace that input.
        if (remote.revision !== this.revision) {
          if (this.pending) {
            this.conflict = true;
            this.onStatus("conflict");
            return;
          }
          this.revision = remote.revision;
          this.data = remote.data;
          this.persist();
          this.onData(this.data);
        }
      }
      this.onStatus(this.pending ? "pending" : "saved");
    } catch (error) {
      if (!this.stopped) this.onStatus("error", error.message);
    } finally { this.busy = false; }
  }
  async useCloud() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const remote = await this.api.read();
      if (this.stopped) return;
      if (!remote.data) throw new Error("Oblak še nima podatkov.");
      this.revision = remote.revision;
      this.data = remote.data;
      this.pending = false;
      this.conflict = false;
      this.persist();
      this.onData(this.data);
      this.onStatus("saved");
    } catch (error) { if (!this.stopped) this.onStatus(this.conflict ? "conflict" : "error", error.message); }
    finally { this.busy = false; }
  }
  stop() { this.stopped = true; }
}
