// The website is in British English, but Coach answers in the language you
// write in, so a reply or a message can be Danish. Marking it lang="da" lets
// browsers hyphenate it with Danish rules and read it with a Danish voice.
// Only Danish is told apart; anything else keeps the page's English.

/** The page's language, for the html element and for English labels set
    inside a Danish passage. */
export const siteLanguage = "en-GB";

// Common words that are only Danish or only English in writing. Words both
// languages spell alike (for, i, at, en, men, min, under) are left out.
const danish = new Set(
  "og ikke jeg du det der er har vil skal kan kunne på så må får gør bliver blev med af til fra som eller nu også godt meget mere mange lidt efter hvis hvad hvordan hvorfor hvornår hvor din dit dine mit dig mig sig vi jeres deres hun han dem noget nogle ingen hver dag dage uge aften morgen frokost aftensmad morgenmad sovet spist spiste husk hej tak".split(
    " ",
  ),
);
const english = new Set(
  "the and you your is are was were will would should can can't could not this that these those with from of to on what how why when where if it its it's have has had be been do does did my me we our they their them there here today tonight sleep slept training workout meal breakfast lunch dinner".split(
    " ",
  ),
);

/** "da" when a passage reads as Danish, otherwise undefined (the page's English). */
export function danishOrNothing(text: string): "da" | undefined {
  let da = 0,
    en = 0;
  for (const word of text.toLowerCase().match(/[\p{L}']+/gu) ?? []) {
    if (danish.has(word)) da += 1;
    else if (english.has(word)) en += 1;
    // Æ, ø and å alone are a weak sign: English replies name Danish food.
    else if (/[æøå]/.test(word)) da += 0.5;
  }
  // A clear majority: an English sentence naming Danish dishes ("rugbrød
  // med leverpostej, frikadeller med kartofler og sovs") stays English.
  return da >= 1.5 && da >= 2 * en ? "da" : undefined;
}
