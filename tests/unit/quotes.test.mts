import { matchQuote, quoteInText } from "../../src/lib/ai/quotes.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- quote verification ----
const body = 'Mira said, "I\'m not afraid."\nThen her hands became hooves.\n\nBlood sprayed everywhere.';
ok(quoteInText("Then her hands became hooves.", body), "verbatim quote found");
ok(quoteInText("Then her   hands\nbecame hooves.", body), "whitespace variants found");
ok(quoteInText("Mira said, “I’m not afraid.”", body), "curly quotes found");
ok(quoteInText("mira said, \"i'm not afraid.\"", body), "case ignored");
ok(quoteInText("...hands became hooves...", body), "leading/trailing ellipsis ignored");
ok(quoteInText("hooves. Blood sprayed", body), "quote spanning a paragraph break found");
ok(!quoteInText("Her hands became wings.", body), "invented quote not found");
ok(!quoteInText("", body) && !quoteInText("   ", body), "empty quote not found");

// ---- matchQuote: the chapter's own words for a loose quote ----
const prose = "The back of her hoodie was bulging, straining, and then it split with a soft rip as a long, stiffening tail lashed free. Feathers were unfurling along Lily’s forearms. More rippled up her neck and down her spine, iridescent in the morning light.";
ok(matchQuote("then it split with a soft rip", prose) === "then it split with a soft rip", "an exact quote comes back as it is");
ok(matchQuote("Feathers were unfurling along Lily's forearms... More rippled up her neck", prose) === "Feathers were unfurling along Lily’s forearms. More rippled up her neck", "pieces joined with ... become the passage they span, in the chapter's words");
ok(matchQuote("The back of her hoodie was bulging, straining, and then split with a soft rip as a long, stiffening tail lashed free", prose)?.startsWith("The back of her hoodie") === true, "a long quote with a word left out still matches");
ok(matchQuote("The back of her coat was swelling and then tore with a loud rip as a tail came out", prose) === null, "a paraphrase does not match");
ok(matchQuote("More rippled up her neck... Feathers were unfurling along", prose) === null, "pieces out of order do not match");
ok(matchQuote("Feathers were unfurling... wings burst from her back", prose) === null, "a quote with one invented piece does not match");
ok(matchQuote("hoodie", prose) === "hoodie" && matchQuote("wings", prose) === null, "a one-word quote must be exact");
ok(matchQuote("The back of her hoodie... iridescent in the morning light", prose, 60) === "The back of her hoodie … iridescent in the morning light", "pieces too far apart are joined with an ellipsis");
