import { readdir, realpath, stat } from "node:fs/promises";
import { extname, resolve, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { categories, type Asset, type AssetCategory } from "@studio/contracts";
const image = [".png", ".jpg", ".jpeg", ".webp"];
const allowed: Record<AssetCategory, string[]> = {
  logos: image,
  backgrounds: image,
  overlays: [".png", ".webp", ".gif"],
  clips: [".mp4", ".webm"],
  music: [".mp3", ".wav", ".ogg"],
  sounds: [".mp3", ".wav", ".ogg"],
};
export class MediaLibrary {
  private files = new Map<string, { asset: Asset; path: string }>();
  constructor(readonly root: string) {}
  async scan(): Promise<Asset[]> {
    const files = new Map<string, { asset: Asset; path: string }>();
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(this.root);
    } catch {
      this.files.clear();
      return [];
    }
    const contained = (p: string) => {
      const rel = relative(canonicalRoot, p);
      return !rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep);
    };
    for (const category of categories) {
      const visited = new Set<string>();
      const walk = async (dir: string) => {
        let canonical: string;
        try {
          canonical = await realpath(dir);
        } catch {
          return;
        }
        if (!contained(canonical) || visited.has(canonical)) return;
        visited.add(canonical);
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const file = resolve(dir, entry.name);
          let path: string;
          try {
            path = await realpath(file);
          } catch {
            continue;
          }
          if (!contained(path)) continue;
          const info = await stat(path);
          if (info.isDirectory()) {
            await walk(file);
            continue;
          }
          const extension = extname(entry.name).toLowerCase();
          if (!info.isFile() || !allowed[category].includes(extension)) continue;
          if (files.size >= 2000)
            throw new Error(
              "Media library exceeds 2,000 files. Split the collection before refreshing.",
            );
          const rel = relative(this.root, file).split(sep).join("/");
          const id = createHash("sha256").update(rel).digest("hex").slice(0, 32);
          const asset: Asset = {
            id,
            category,
            filename: rel,
            name: entry.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
            url: `/media/${id}`,
            kind:
              category === "clips"
                ? "video"
                : category === "music" || category === "sounds"
                  ? "audio"
                  : "image",
            version: `${info.size}-${Math.trunc(info.mtimeMs)}`,
          };
          files.set(id, { asset, path });
        }
      };
      await walk(resolve(this.root, category));
    }
    this.files = files;
    return [...files.values()].map((f) => f.asset).sort((a, b) => a.name.localeCompare(b.name));
  }
  asset(id: string) {
    return this.files.get(id)?.asset;
  }
  async path(id: string): Promise<string | null> {
    const f = this.files.get(id);
    if (!f) return null;
    try {
      const root = await realpath(this.root);
      const actual = await realpath(f.path);
      const rel = relative(root, actual);
      if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) return null;
      return (await stat(actual)).isFile() ? actual : null;
    } catch {
      return null;
    }
  }
}
