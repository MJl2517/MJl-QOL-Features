const ID = "mjl-ilmaren-combat";
const { DialogV2 } = foundry.applications.api;
const t = key => game.i18n.localize(`MJLQOL.WorldCopy.${key}`);
const quote = text => `'${text.replaceAll("'", "''")}'`;

class WorldCopyDialog extends DialogV2 {
  constructor(options = {}) {
    const content = document.createElement("div");
    content.innerHTML = `<p>${t("Intro")}</p>
      <label class="form-group"><span>${t("Name")}</span>
        <input name="title" type="text" required maxlength="120"></label>
      <label class="form-group"><span>${t("Id")}</span>
        <input name="id" type="text" required maxlength="64"></label>
      <label class="form-group"><span>${t("Path")}</span>
        <input name="dataPath" type="text" placeholder="%LOCALAPPDATA%\\FoundryVTT"></label>`;
    content.querySelector('[name="title"]').defaultValue = `${(game.world.title ?? game.world.id).slice(0, 110)} — ${t("Suffix")}`;
    content.querySelector('[name="id"]').defaultValue = `${game.world.id.slice(0, 59)}-copy`;
    super({
      ...options,
      window: { title: t("Title"), icon: "fa-solid fa-copy" },
      content,
      position: { width: 500 },
      buttons: [{ action: "prepare", label: t("Prepare"), default: true, callback: (_event, button) => {
        const data = new FormData(button.form);
        const title = data.get("title").trim();
        const id = data.get("id").trim();
        const source = game.world.id;
        if (!title || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || source === id) {
          ui.notifications.warn(t("Invalid"));
          return;
        }
        const dataPath = data.get("dataPath").trim();
        const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ source, id, title }))));
        const root = dataPath ? quote(dataPath) : "(Join-Path $env:LOCALAPPDATA 'FoundryVTT')";
        const command = `$foundryData = ${root}; & node (Join-Path $foundryData 'Data/modules/${ID}/host/clone-world.cjs') $foundryData '${payload}'`;
        showCommand(command);
      } }, { action: "cancel", label: t("Cancel") }]
    });
  }
}

function showCommand(command) {
  const content = document.createElement("div");
  const help = document.createElement("p");
  help.textContent = t("Run");
  const field = document.createElement("textarea");
  field.defaultValue = command;
  field.readOnly = true;
  field.rows = 5;
  field.setAttribute("aria-label", t("Command"));
  content.append(help, field);
  void new DialogV2({
    window: { title: t("Title") }, content, form: { closeOnSubmit: false }, position: { width: 520 },
    buttons: [{ action: "copy", label: t("Copy"), callback: async () => {
      try {
        await navigator.clipboard.writeText(command);
        ui.notifications.info(t("Copied"));
      } catch {
        ui.notifications.info(t("ManualCopy"));
      }
    } }, { action: "close", label: t("Close"), callback: (_event, _button, dialog) => dialog.close() }]
  }).render({ force: true });
}

Hooks.once("init", () => {
  game.settings.registerMenu(ID, "worldCopy", {
    name: "MJLQOL.WorldCopy.Title", label: "MJLQOL.WorldCopy.Prepare", hint: "MJLQOL.WorldCopy.Hint",
    icon: "fa-solid fa-copy", type: WorldCopyDialog, restricted: true
  });
});
