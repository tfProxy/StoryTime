// For tests that read or use the folded sections of a codex entry's page (Facts, What the AI reads, Flesh out,
// History, Name/type/keywords): opens each fold the first time it appears, so the test can go on as if the page were
// one long column. A fold the test then closes itself stays closed. Tests of the folds themselves use a context without it.
export async function unfoldEntryFolds(context) {
  await context.addInitScript(() => {
    const open = () => {
      for (const d of document.querySelectorAll("details.entry-fold:not([data-unfolded])")) {
        d.setAttribute("data-unfolded", "1");
        d.open = true;
      }
    };
    new MutationObserver(open).observe(document, { childList: true, subtree: true });
  });
}
