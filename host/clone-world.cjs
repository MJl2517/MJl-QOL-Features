const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const validId = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const json = async file => JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const textFile = /\.(?:json|html?|svg|css|m?js|md|txt)$/i;

async function clone(dataRoot, { source, id, title }) {
  if (typeof source !== "string" || typeof id !== "string" || !validId.test(source) || !validId.test(id)
    || source === id || typeof title !== "string" || !title.trim() || title.length > 120) {
    throw Error("Укажите разные ID миров и название копии.");
  }
  if (!path.isAbsolute(dataRoot)) throw Error("Укажите полный путь к папке Foundry User Data.");
  const root = await fs.realpath(dataRoot);
  const data = await fs.realpath(path.join(root, "Data"));
  const worlds = await fs.realpath(path.join(data, "worlds"));
  if (path.relative(path.join(root, "Data", "worlds"), worlds)) throw Error("Папка Data/worlds является ссылкой.");
  const original = path.join(worlds, source);
  const destination = path.join(worlds, id);
  if (path.relative(original, await fs.realpath(original))) throw Error("Папка исходного мира является ссылкой.");
  const options = await json(path.join(root, "Config", "options.json"));
  const port = options.port ?? 30000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Не удалось определить порт Foundry.");
  const requireStopped = () => {
    const listener = new RegExp(`:${port}\\s+[^\\r\\n]*LISTENING\\b`, "i");
    if (listener.test(execFileSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true }))) {
      throw Error(`Foundry ещё работает на порту ${port}. Закройте сервер и повторите команду.`);
    }
  };
  const requireUnlocked = () => {
    try {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", [
        "$ErrorActionPreference='Stop'",
        "Get-ChildItem -LiteralPath $env:MJL_COPY_SOURCE -Filter LOCK -File -Recurse | ForEach-Object {",
        "  $lock=[IO.File]::Open($_.FullName,'Open','Read','None')",
        "  $lock.Dispose()",
        "}"
      ].join("\n")], { env: { ...process.env, MJL_COPY_SOURCE: original }, stdio: "ignore", windowsHide: true });
    } catch {
      throw Error("Не удалось получить доступ к файлам блокировки мира. Полностью остановите Foundry.");
    }
  };
  const manifest = await json(path.join(original, "world.json"));
  if (manifest.id !== source) throw Error("ID исходного мира не совпадает с его папкой.");
  const requireNewDestination = async () => {
    const occupied = (await fs.readdir(worlds)).some(name => name.toLowerCase() === id);
    if (occupied) throw Error(`Мир с ID «${id}» уже существует.`);
  };
  requireStopped();
  requireUnlocked();
  await requireNewDestination();

  const foundryApp = process.env.MJL_FOUNDRY_APP ?? path.join(process.env.ProgramFiles ?? "C:\\Program Files",
    "Foundry Virtual Tabletop", "resources", "app");
  const { ClassicLevel } = require(path.join(foundryApp, "node_modules", "classic-level"));
  const fromPath = new RegExp(`\\bworlds([/\\\\]+|%2f)${source}(?=[/\\\\]|%2f|[?#"'\\s]|$)`, "gi");
  const replace = value => value.replace(fromPath, (_match, slash) => `worlds${slash}${id}`);
  const stage = await fs.mkdtemp(path.join(data, ".mjl-world-copy-"));

  async function updateCopy(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    if (entries.some(entry => entry.isFile() && entry.name === "CURRENT") && entries.some(entry => entry.name.startsWith("MANIFEST-"))) {
      const db = new ClassicLevel(directory, { valueEncoding: "utf8", createIfMissing: false });
      await db.open();
      try {
        let updates = [];
        for await (const [key, value] of db.iterator()) {
          const updated = replace(value);
          if (updated === value) continue;
          JSON.parse(updated);
          updates.push({ type: "put", key, value: updated });
          if (updates.length === 250) {
            await db.batch(updates);
            updates = [];
          }
        }
        if (updates.length) await db.batch(updates);
      } finally {
        await db.close();
      }
      return;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await updateCopy(file);
      else if (entry.isFile() && textFile.test(entry.name)) {
        const originalText = await fs.readFile(file, "utf8");
        const updated = replace(originalText);
        if (updated !== originalText) await fs.writeFile(file, updated, "utf8");
      }
    }
  }

  try {
    await fs.cp(original, stage, {
      recursive: true,
      filter: async file => {
        if ((await fs.lstat(file)).isSymbolicLink()) throw Error("В исходном мире есть ссылка на другой путь.");
        return path.basename(file) !== "LOCK";
      }
    });
    requireStopped();
    requireUnlocked();
    await updateCopy(stage);
    const manifestPath = path.join(stage, "world.json");
    const copy = await json(manifestPath);
    copy.id = id;
    copy.title = title.trim();
    for (const pack of copy.packs ?? []) {
      if (pack.packageName === source) pack.packageName = id;
    }
    await fs.writeFile(manifestPath, JSON.stringify(copy, null, 2) + "\n", "utf8");
    await requireNewDestination();
    requireStopped();
    await fs.rename(stage, destination);
    return destination;
  } catch (error) {
    if (path.dirname(stage) === data && path.basename(stage).startsWith(".mjl-world-copy-")) {
      await fs.rm(stage, { recursive: true, force: true });
    }
    throw error;
  }
}

(async () => {
  const [dataRoot, payload] = process.argv.slice(2);
  if (!dataRoot || !payload) throw Error("Скопируйте команду из раздела «Копия мира» в настройках QOL.");
  const request = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  const destination = await clone(dataRoot, request);
  console.log(`Копия готова. Папка: ${destination}`);
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
