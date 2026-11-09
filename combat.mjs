const ID = "mjl-ilmaren-combat";
const pending = new Map();
const report = error => console.error(ID, error);

Hooks.once("init", () => {
  for (const key of ["removeSpellAreas", "unconsciousAtZeroHP"]) {
    game.settings.register(ID, key, {
      name: `MJLQOL.${key}.name`,
      hint: `MJLQOL.${key}.hint`,
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      requiresReload: true
    });
  }
});

// Foundry 14 returns legacy template documents from dnd5e placement; the saved documents are Regions.
async function linkAreas(activity, { message, templates }) {
  if (!message?.canUserModify?.(game.user, "update")) return;
  const regions = [...new Set(templates.flat().map(t => t.parent?.regions?.get(t.id)))]
    .filter(r => r?.getFlag("core", "MeasuredTemplate")
      && r.getFlag("dnd5e", "origin") === activity.uuid && r.canUserModify(game.user, "update"));
  if (!regions.length) return;
  for (const region of regions) await region.setFlag(ID, "cast", message.id);
  await message.setFlag(ID, "regions", regions.map(r => r.uuid));
}

Hooks.on("dnd5e.postUseActivity", (activity, _usage, results) => {
  if (!game.settings.get(ID, "removeSpellAreas")) return;
  if (results.templates?.length) void linkAreas(activity, results).catch(report);
});

function deletableAreas(message) {
  const uuids = message.getFlag(ID, "regions");
  const origin = message.getFlag("dnd5e", "activity.uuid");
  if (!origin || !Array.isArray(uuids)) return [];
  return [...new Set(uuids)].flatMap(uuid => {
    const ref = typeof uuid === "string" && /^Scene\.([a-zA-Z0-9]{16})\.Region\.([a-zA-Z0-9]{16})$/.exec(uuid);
    const region = ref && game.scenes.get(ref[1])?.regions.get(ref[2]);
    return region?.getFlag("core", "MeasuredTemplate")
      && region.getFlag(ID, "cast") === message.id && region.getFlag("dnd5e", "origin") === origin
      && region.canUserModify(game.user, "delete") ? [region] : [];
  });
}

Hooks.on("dnd5e.renderChatMessage", (message, html) => {
  if (!game.settings.get(ID, "removeSpellAreas") || !message.isContentVisible) return;
  const cast = message.getOriginatingMessage();
  if (!cast.isContentVisible || !deletableAreas(cast).length) return;
  const host = html.querySelector(".card-buttons") ?? html.querySelector(".message-content");
  if (!host || host.querySelector("[data-mjl-remove-area]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.mjlRemoveArea = cast.id;
  button.textContent = game.i18n.localize("MJLQOL.RemoveArea");
  button.addEventListener("click", async () => {
    if (!game.settings.get(ID, "removeSpellAreas")) return button.remove();
    button.disabled = true;
    try {
      for (const region of deletableAreas(cast)) await region.delete();
      if (!deletableAreas(cast).length) button.remove();
    } catch (error) {
      report(error);
      ui.notifications.error(game.i18n.localize("MJLQOL.RemoveAreaError"));
    } finally {
      button.disabled = false;
    }
  });
  host.append(button);
});

Hooks.on("deleteRegion", region => {
  const cast = game.messages.get(region.getFlag(ID, "cast"));
  if (!cast || deletableAreas(cast).length) return;
  for (const button of document.querySelectorAll("[data-mjl-remove-area]")) {
    if (button.dataset.mjlRemoveArea === cast.id) button.remove();
  }
});

function shouldFall(actor) {
  return actor.system.attributes?.hp?.value === 0 && !actor.statuses.has("unconscious")
    && !actor.statuses.has("dead") && !actor.system.traits?.ci?.value?.has?.("unconscious");
}

async function syncUnconscious(actor) {
  if (!game.settings.get(ID, "unconsciousAtZeroHP")) return;
  if (actor.system.attributes?.hp?.value >= 1) {
    const ids = actor.effects.filter(effect => effect.getFlag(ID, "fromZeroHP")
      && effect.statuses.has("unconscious")).map(effect => effect.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  } else if (shouldFall(actor)) {
    const effect = await ActiveEffect.implementation.fromStatusEffect("unconscious", { parent: actor });
    if (!game.settings.get(ID, "unconsciousAtZeroHP") || !shouldFall(actor)) return;
    effect.updateSource({ [`flags.${ID}.fromZeroHP`]: true });
    await actor.createEmbeddedDocuments("ActiveEffect", [effect.toObject()]);
  }
}

Hooks.on("updateActor", (actor, change, _options, userId) => {
  if (!game.settings.get(ID, "unconsciousAtZeroHP")) return;
  const hp = change.system?.attributes?.hp?.value ?? change["system.attributes.hp.value"];
  if (!Number.isFinite(hp) || !["character", "npc"].includes(actor.type) || actor.pack) return;
  if (!(game.users.activeGM ? game.user.isActiveGM : game.user.id === userId && actor.isOwner)) return;
  const task = (pending.get(actor.uuid) ?? Promise.resolve()).then(() => syncUnconscious(actor)).catch(report);
  pending.set(actor.uuid, task);
  void task.then(() => { if (pending.get(actor.uuid) === task) pending.delete(actor.uuid); });
});
