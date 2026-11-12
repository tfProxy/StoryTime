// Helpers for tests of a codex entry's own page (/s/<story>/codex/<entry>?at=<chapter>): its fact rows, their ⋯ menus,
// the entry's ⋯ menu, the fact editor and the tabs.

/** The fact row whose value has this text. */
export const factRow = (page, text) => page.locator(".entry-facts .fact-row").filter({ has: page.locator(".fact-line", { hasText: text }) });

/** Picks an item in a fact row's ⋯ menu ("History", "Remove from …", "Retcon the chapters…", "Edit"). */
export async function rowAction(row, name) {
  await row.locator(".ef-menu .more-menu > summary").click();
  await row.locator(".ef-menu .more-menu-items").getByRole(name.startsWith("Retcon") ? "link" : "button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
}

/** Picks an item in the entry's ⋯ menu (in the bar at the top). */
export async function entryAction(page, name, role = "button") {
  await page.locator(".entry-bar").getByLabel("More entry actions", { exact: true }).click();
  await page.locator(".entry-bar .more-menu-items").getByRole(role, { name, exact: true }).click();
}

/** Opens a tab at the foot of the page ("What the AI reads", "History", "Update from the story"). */
export async function openTab(page, name) {
  await page.getByRole("tab", { name, exact: true }).click();
  return page.getByRole("tabpanel");
}

/** Sets the Aspect select within `scope`: a name on the list (or the entry's own), else "Other…" and a typed name. */
export async function pickAspect(scope, aspect) {
  const sel = scope.getByLabel("Aspect", { exact: true });
  if ((await sel.locator("option", { hasText: new RegExp(`^${aspect}$`) }).count()) > 0) await sel.selectOption({ label: aspect });
  else {
    await sel.selectOption({ label: "Other…" });
    await scope.getByLabel("New aspect").fill(aspect);
  }
}

/**
 * Fills the open fact editor and saves it: { aspect, text, applies ("every form", "<form> only", or a new form's name),
 * kind ("change" | "correction") }.
 */
export async function fillFact(page, { aspect, text, applies, kind }) {
  const form = page.locator(".ef-editor");
  if (aspect !== undefined) await pickAspect(form, aspect);
  if (text !== undefined) await form.getByLabel("Fact", { exact: true }).fill(text);
  if (applies) {
    const sel = form.getByLabel("Applies to");
    if ((await sel.locator("option", { hasText: new RegExp(`^${applies}$`) }).count()) > 0) await sel.selectOption({ label: applies });
    else {
      await sel.selectOption({ label: "+ a new form…" });
      await form.getByLabel("New form name").fill(applies);
    }
  }
  if (kind === "correction") await form.getByRole("radio", { name: /a correction/ }).check();
  if (kind === "change") await form.getByRole("radio", { name: /a change in the story/ }).check();
  await form.getByRole("button", { name: "Save", exact: true }).click();
}

/** "+ Add a fact", filled and saved. */
export async function addFact(page, fields) {
  await page.locator(".entry-facts").getByRole("button", { name: "+ Add a fact" }).click();
  await fillFact(page, fields);
}
