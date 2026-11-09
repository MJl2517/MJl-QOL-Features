const ID = "mjl-toolbox";
const QOL_ID = "mjl-ilmaren-combat";
const SETTING = "storedButtons";
const TITLE = "Склад инструментов";
const CONFIGURE = "Настройка отображения";

const key = (control, tool = null) => JSON.stringify([control, tool]);
const enabled = () => game.settings.get(QOL_ID, "toolbox") && !game.modules.get(ID)?.active;
function stored() {
  const settings = game.settings.storage.get("user");
  const current = settings.getSetting(`${QOL_ID}.${SETTING}`, game.user.id);
  const legacy = settings.getSetting(`${ID}.${SETTING}`, game.user.id);
  return new Set(current?.value ?? legacy?.value ?? []);
}
const sorted = record => Object.values(record).sort((a, b) => a.order - b.order);

function element(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

function button(label, icon) {
  const node = element("button");
  node.type = "button";
  const glyph = element("i");
  glyph.className = icon ?? "fa-solid fa-wrench";
  glyph.setAttribute("aria-hidden", "true");
  node.append(glyph, element("span", label));
  return node;
}

function categories(app) {
  const localize = title => game.i18n.localize(title);
  return sorted(app.controls).map(control => ({
    title: localize(control.title),
    layer: {id: key(control.name), control: control.name, icon: control.icon},
    tools: sorted(control.tools).map(tool => ({
      id: key(control.name, tool.name), control: control.name, tool: tool.name,
      label: localize(tool.title), icon: tool.icon
    }))
  }));
}

function section(title, count) {
  const group = element("details");
  group.append(element("summary", `${title} (${count})`));
  return group;
}

async function configure(app) {
  const selection = stored();
  const content = element("div");
  const list = element("div");
  list.className = "mjl-toolbox-config";
  content.append(element("p", "Перенесите в склад весь раздел или отдельные инструменты. Снимите отметку, чтобы вернуть их на панель."), list);

  for (const {title, layer, tools} of categories(app)) {
    const entries = [{...layer, label: "Перенести весь раздел"}, ...tools];
    const group = section(title, tools.length);
    group.open = entries.some(entry => selection.has(entry.id));
    for (const entry of entries) {
      const label = element("label");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.name = "stored";
      checkbox.value = entry.id;
      checkbox.toggleAttribute("checked", selection.has(entry.id));
      label.append(checkbox, element("span", entry.label));
      group.append(label);
    }
    list.append(group);
  }

  const changes = await foundry.applications.api.DialogV2.prompt({
    id: `${ID}-config`, window: {title: CONFIGURE}, position: {width: 440}, modal: true, content,
    ok: {
      label: "Сохранить",
      callback: (_event, save) => [...save.form.querySelectorAll('input[name="stored"]')]
        .map(input => [input.value, input.checked])
    },
    buttons: [{action: "cancel", label: "Отмена", callback: () => false}]
  });
  if (!changes) return;
  const updated = stored();
  // Keep preferences for tools that aren't available on this scene or with the current modules.
  for (const [id, checked] of changes) {
    if (checked === selection.has(id)) continue;
    if (checked) updated.add(id);
    else updated.delete(id);
  }
  try {
    await game.settings.set(QOL_ID, SETTING, [...updated]);
  } catch (error) {
    console.error(`${ID} | Could not save button preferences`, error);
    ui.notifications.error("Не удалось сохранить настройки склада инструментов.");
  }
}

async function useButton(app, entry, event) {
  if (!canvas.ready || !app.controls[entry.control]) return;
  if (entry.tool && app.control?.name !== entry.control) {
    await app.activate({control: entry.control});
    if (app.control?.name !== entry.control) return;
  }

  // Send the click through Foundry's original button so layer, toggle and tool behavior stay intact.
  const attribute = entry.tool ? "tool" : "control";
  const name = CSS.escape(entry.tool ?? entry.control);
  const original = app.element.querySelector(`button[data-action="${attribute}"][data-${attribute}="${name}"]`);
  original?.dispatchEvent(new MouseEvent("click", event));
}

function fill(app, panel, trigger) {
  const configureButton = button(CONFIGURE, "fa-solid fa-gear");
  configureButton.onclick = () => {
    panel.hidePopover();
    configure(app);
  };
  panel.replaceChildren(configureButton);

  const selection = stored();
  for (const {title, layer, tools} of categories(app)) {
    const available = selection.has(layer.id)
      ? [{...layer, label: "Открыть раздел"}, ...tools]
      : tools.filter(tool => selection.has(tool.id));
    if (!available.length) continue;
    const group = section(title, available.length);
    for (const entry of available) {
      const item = button(entry.label, entry.icon);
      item.onclick = event => {
        panel.hidePopover();
        trigger.focus();
        useButton(app, entry, event);
      };
      group.append(item);
    }
    panel.append(group);
  }
  if (panel.childElementCount === 1) panel.append(element("p", "Склад пока пуст."));
}

function sync(app, html) {
  if (!enabled()) return;
  const layers = html.querySelector("menu:has(> li > button.layer[data-control])");
  if (!layers) return;
  const selection = stored();
  for (const node of html.querySelectorAll("button.layer[data-control], button.tool[data-tool]")) {
    const control = node.dataset.control ?? app.control?.name;
    const hidden = selection.has(key(control)) || selection.has(key(control, node.dataset.tool));
    node.closest("li")?.classList.toggle("mjl-toolbox-stored", hidden);
  }

  if (layers.querySelector(`#${ID}-trigger`)) return;
  html.querySelector(`#${ID}-panel`)?.remove();
  const row = element("li");
  const trigger = element("button");
  trigger.type = "button";
  trigger.id = `${ID}-trigger`;
  trigger.className = "ui-control icon fa-solid fa-toolbox";
  trigger.setAttribute("aria-label", TITLE);
  trigger.setAttribute("data-tooltip", "");
  trigger.setAttribute("popovertarget", `${ID}-panel`);
  const panel = element("div");
  panel.id = `${ID}-panel`;
  panel.setAttribute("popover", "auto");
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", TITLE);
  panel.addEventListener("beforetoggle", event => {
    if (event.newState === "open") fill(app, panel, trigger);
  });
  row.append(trigger);
  layers.append(row);
  html.append(panel);
}

Hooks.once("init", () => {
  game.settings.register(QOL_ID, SETTING, {
    scope: "user", config: false, type: Array, default: [],
    onChange: () => {
      if (ui.controls?.rendered) sync(ui.controls, ui.controls.element);
    }
  });
});
Hooks.on("renderSceneControls", sync);
