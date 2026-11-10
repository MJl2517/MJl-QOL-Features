const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const app = process.env.MJL_FOUNDRY_APP ?? path.join(process.env.ProgramFiles, "Foundry Virtual Tabletop", "resources", "app");
const { ClassicLevel } = require(path.join(app, "node_modules", "classic-level"));
const runner = path.resolve(__dirname, "../host/clone-world.cjs");
const open = path => new ClassicLevel(path, { valueEncoding: "json" });

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mjl-copy-test-"));
  try {
    const worlds = path.join(root, "Data", "worlds");
    const source = path.join(worlds, "source-world");
    const manifest = { id: "source-world", title: "Исходный мир", system: "dnd5e",
      packs: [{name: "secret", packageName: "source-world", ownership: {PLAYER: "NONE"}}] };
    await fs.mkdir(path.join(source, "assets"), { recursive: true });
    await fs.mkdir(path.join(source, "data"), { recursive: true });
    await fs.mkdir(path.join(root, "Config"));
    await fs.writeFile(path.join(root, "Config", "options.json"), '{"port":41719}');
    await fs.writeFile(path.join(source, "world.json"), JSON.stringify(manifest));
    await fs.writeFile(path.join(source, "assets", "map.png"), Buffer.from([0, 120, 255]));
    const db = open(path.join(source, "data", "scenes"));
    await db.open();
    const scene = { texture: "worlds/source-world/assets/map.png", body: '<img src="worlds/source-world/assets/map.png">',
      shared: "modules/shared/map.png", similar: "worlds/source-world-other/map.png" };
    await db.put("scene", scene);
    await db.close();

    const payload = Buffer.from(JSON.stringify({ source: "source-world", id: "campaign-1", title: "Ильмарен — 1" })).toString("base64");
    const run = () => spawnSync(process.execPath, [runner, root, payload], { encoding: "utf8" });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const dest = path.join(worlds, "campaign-1");
    const clone = JSON.parse(await fs.readFile(path.join(dest, "world.json"), "utf8"));
    assert.deepEqual(clone, { ...manifest, id: "campaign-1", title: "Ильмарен — 1",
      packs: [{ ...manifest.packs[0], packageName: "campaign-1" }] });
    assert.deepEqual(await fs.readFile(path.join(dest, "assets", "map.png")), Buffer.from([0, 120, 255]));
    const copiedDb = open(path.join(dest, "data", "scenes"));
    await copiedDb.open();
    assert.deepEqual(await copiedDb.get("scene"), { ...scene, texture: "worlds/campaign-1/assets/map.png",
      body: '<img src="worlds/campaign-1/assets/map.png">' });
    await copiedDb.close();
    assert.equal(await fs.readFile(path.join(source, "world.json"), "utf8"), JSON.stringify(manifest));
    const repeat = run();
    assert.equal(repeat.status, 1);
    assert.match(repeat.stderr, /уже существует/);
    console.log("Копия открывается, пути и приватный компендиум перенесены, повтор защищён.");
  } finally {
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith("mjl-copy-test-")) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
