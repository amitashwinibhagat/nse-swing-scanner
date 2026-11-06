import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

/**
 * Snapshots are committed under public/data/snapshots because the dashboard
 * diffs against the previous one ("what changed since the last scan", the
 * receipts strip, and the entry-state chips all read `/data/snapshots/<file>`).
 * Vite copies *all* of public/ into dist, so the deploy carried 134 MB of
 * history the app never asks for.
 *
 * This plugin trims dist/data/snapshots to history_index.json plus the newest
 * KEEP snapshots after the build. The committed repo is untouched — the
 * outcome tracker still reads the full history from public/.
 */
const KEEP_DEPLOYED_SNAPSHOTS = 12;

function pruneDeployedSnapshots() {
  return {
    name: "prune-deployed-snapshots",
    apply: "build",
    closeBundle() {
      const dir = path.resolve(process.cwd(), "dist/data/snapshots");
      if (!fs.existsSync(dir)) return;

      const files = fs
        .readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}-(am|pm)\.json$/.test(f))
        .sort();
      const drop = files.slice(0, Math.max(0, files.length - KEEP_DEPLOYED_SNAPSHOTS));
      for (const f of drop) fs.unlinkSync(path.join(dir, f));

      // The index is read at runtime, so it must list only what is deployed —
      // otherwise the UI links to 404s.
      const indexFile = path.join(dir, "history_index.json");
      if (fs.existsSync(indexFile)) {
        try {
          const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
          if (Array.isArray(index)) {
            const kept = new Set(files.slice(-KEEP_DEPLOYED_SNAPSHOTS));
            fs.writeFileSync(
              indexFile,
              JSON.stringify(index.filter((e) => kept.has(e && e.file)), null, 2)
            );
          }
        } catch {
          /* leave the index untouched if it is unparseable */
        }
      }

      if (drop.length) {
        // eslint-disable-next-line no-console
        console.log(`pruned ${drop.length} snapshot(s) from dist (kept ${KEEP_DEPLOYED_SNAPSHOTS})`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pruneDeployedSnapshots()],
});
