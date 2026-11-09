const ID = "mjl-ilmaren-combat";
const LEGACY_ID = "mjl-combat-ammo";
const expected = new WeakMap();
const pending = new Map();
const enabled = () => game.settings.get(ID, "combatAmmo") && !game.modules.get(LEGACY_ID)?.active;

function participant(combat, actor) {
  return combat?.started && actor?.type === "character"
    && combat.combatants.some(c => !c.hidden && c.actor?.uuid === actor.uuid);
}

function isAmmo(item) {
  return item?.type === "consumable" && item.system.type?.value === "ammo";
}

function isThrownWeapon(item) {
  return item?.type === "weapon" && item.system.properties.has("thr");
}

Hooks.on("dnd5e.postAttackRollConfiguration", (rolls, { subject }) => {
  const weapon = subject?.item;
  if (game.user.isGM || !rolls.length || weapon?.type !== "weapon" || !weapon.system.properties.has("amm")) return;
  const selected = rolls[0].options.ammunition;
  const available = weapon.system.ammunitionOptions.filter(option => option.item.system.quantity > 0);
  if (available.some(option => option.value === selected)) return;
  ui.notifications.warn(available.length ? "MJLQOL.AmmoSelect" : "MJLQOL.AmmoEmpty", { localize: true });
  return false;
});

// The system announces the shot before consuming ammo. Carry its combat ID on the actual
// document operation so the GM can count successful changes made by any player.
Hooks.on("dnd5e.rollAttack", (rolls, { subject, ammoUpdate }) => {
  if (!enabled()) return;
  const actor = subject?.actor;
  const item = actor?.items.get(ammoUpdate?.id);
  const thrown = isThrownWeapon(item) && item.id === subject.item.id
    && rolls[0]?.options.attackMode?.startsWith("thrown");
  if (!(isAmmo(item) || thrown) || !subject.item.isOwner || item.system.quantity < 1) return;
  const combat = game.combats.find(c => c.isActive && participant(c, actor));
  if (combat) expected.set(item, {
    combatId: combat.id, quantity: ammoUpdate.quantity, destroy: !!ammoUpdate.destroy, expires: Date.now() + 10000
  });
});

function mark(item, quantity, destroy, options) {
  const shot = expected.get(item);
  if (!shot || shot.expires < Date.now() || shot.destroy !== destroy || shot.quantity !== quantity) return;
  expected.delete(item);
  options[ID] ??= {};
  options[ID][item.id] = shot.combatId;
}

Hooks.on("preUpdateItem", (item, change, options) => {
  const quantity = change.system?.quantity;
  if (quantity === item.system.quantity - 1) mark(item, quantity, false, options);
});
Hooks.on("preDeleteItem", (item, options) => {
  if (item.system.quantity === 1) mark(item, 0, true, options);
});

function record(item, options) {
  if (!game.user.isActiveGM || !enabled() || !(isAmmo(item) || isThrownWeapon(item))) return;
  const combat = game.combats.get(options[ID]?.[item.id]);
  const actor = item.actor;
  if (!participant(combat, actor)) return;
  const id = foundry.utils.randomID();
  const shot = {
    actor: actor.uuid, name: actor.name, ammo: item.name, subtype: item.system.type.subtype ?? "",
    magical: isAmmo(item) && item.system.properties.has("mgc"),
    thrown: isThrownWeapon(item)
  };
  if (!pending.has(combat.id)) pending.set(combat.id, new Map());
  const shots = pending.get(combat.id);
  shots.set(id, shot);
  // Each shot has its own key, so simultaneous updates never overwrite one another.
  combat.update({ [`flags.${ID}.shots.${id}`]: shot }).then(updated => {
    if (!updated) return;
    shots.delete(id);
    if (!shots.size && pending.get(combat.id) === shots) pending.delete(combat.id);
  }).catch(error => {
    if (game.combats.has(combat.id)) console.error(ID, error);
  });
}

Hooks.on("updateItem", (item, change, options) => {
  if (Number.isSafeInteger(change.system?.quantity)) record(item, options);
});
Hooks.on("deleteItem", record);

Hooks.on("deleteCombat", combat => {
  if (!game.user.isActiveGM || !combat.started || !enabled()) return;
  const shots = { ...combat.flags[LEGACY_ID]?.shots, ...combat.getFlag(ID, "shots"),
    ...Object.fromEntries(pending.get(combat.id) ?? []) };
  pending.delete(combat.id);
  const totals = new Map();
  const entries = Object.values(shots);
  const hasMagic = entries.some(shot => shot.magical);
  const hasThrown = entries.some(shot => shot.thrown);
  for (const shot of entries) {
    const key = JSON.stringify([shot.actor, shot.thrown === true, shot.subtype, shot.ammo]);
    if (!totals.has(key)) totals.set(key, { ...shot, spent: 0 });
    totals.get(key).spent++;
  }
  const escape = foundry.utils.escapeHTML;
  const rows = [...totals.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.ammo.localeCompare(b.ammo, "ru"))
    .map(({ name, ammo, spent, thrown }) =>
      `<li>
        <div class="mjl-ammo-item"><strong>${escape(ammo)}</strong><span>${escape(name)}</span></div>
        <dl class="mjl-ammo-counts">
          <div><dt>${thrown ? "Брошено" : "Потрачено"}</dt><dd>${spent}</dd></div>
          ${thrown ? "" : `<div><dt>К возврату</dt><dd>${Math.floor(spent / 2)}</dd></div>`}
        </dl>
      </li>`)
    .join("");
  const content = `<section class="mjl-ammo-report">
    <h3><i class="fa-solid fa-bullseye" aria-hidden="true"></i> ${hasThrown ? "Боеприпасы и метательное оружие" : "Боеприпасы после боя"}</h3>
    ${rows
      ? `<ul class="mjl-ammo-list">${rows}</ul>`
      : "<p>Боеприпасы не расходовались.</p>"}
    ${entries.some(shot => !shot.thrown) ? "<p>1 минута сбора · половина боеприпасов каждого вида, округляя вниз.</p>" : ""}
    ${hasThrown ? "<p>Брошенное оружие подбирается вручную, если его удалось найти.</p>" : ""}
    ${hasMagic ? "<p>Снаряды +1/+2/+3 после попадания подбираются как обычные. При промахе найденный снаряд сохраняет бонус.</p>" : ""}
  </section>`;
  foundry.documents.ChatMessage.create({ speaker: { alias: "Боевой отчёт" }, content })
    .catch(error => console.error(ID, error));
});
