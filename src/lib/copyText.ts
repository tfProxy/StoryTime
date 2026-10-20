/**
 * Copies text where `navigator.clipboard` isn't available (it needs a secure context; StoryTime is often served over plain http).
 * From a modal dialog, pass the dialog as `within`: the rest of the page can't be selected while it is open.
 */
export async function copyText(text: string, within: HTMLElement = document.body): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the fallback
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  // Selecting the text moves the focus; it goes back to the button afterwards.
  const focused = document.activeElement as HTMLElement | null;
  within.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    focused?.focus();
  }
}
