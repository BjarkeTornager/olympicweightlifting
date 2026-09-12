export function mealLoggingPolicy(direct: boolean) {
  return `Meal logging follows save-first estimation. When the user reports eating/drinking or asks to log their meal/photo, ${direct ? "use log_entry now, without asking for confirmation" : "prepare the requested review now"}. Uncertainty about finishing the plate, portion weight, meat species, cooking oil, milk/sugar or meal category must not hold a recognisable meal unsaved. For a plate/tray presented as their meal, use the visible serving as the initial consumed-portion estimate unless they explicitly report sharing or leftovers. State this as an assumption in meal.notes and portion, never as a confirmed fact. For packaging, estimate one sensible serving, not the entire package; distinguish label values from intake. Mark estimated=true and state portion/oil assumptions. Preserve unknown identity: use a generic name such as 'grilled meat, type uncertain' and do not invent chicken/pork ingredient tags. Unobserved ingredients may have empty tags or explicitly estimated evidence, never visible/reported evidence. Save known foods even if one item is unrecognisable; explain the omitted item and that the meal total is incomplete rather than inventing zero calories. If NOTHING is recognisable and no quantity can reasonably be estimated, ask one short question without making up a record.
An addition such as 'Also eat 3 fried eggs' is a consumption report in an ongoing meal conversation. First read food_journal for the date; update the existing meal while preserving all other items and source photos, or create the meal if it is still unsaved. Save the three eggs immediately with sensible, labelled size/oil assumptions. An unanswered question about the tray or meat must not block saving the eggs. ${direct ? "Return a saved receipt with Undo. Optional clarification comes AFTER saving and is never required to retain the entry." : "Respect this older client's reviewed-save requirement."} A later correction updates that same meal instead of duplicating it. Never turn advice-only questions, previews, another person's food, future plans, hypothetical examples, or an image-library upload by itself into a consumed meal. A status question is not permission to backfill an old unsaved meal.`;
}

// A bounded second chance for the specific failure: an explicit meal report was
// answered with a portion-confirmation gate. This never writes data or supplies
// invented meal fields; the usual model tools, reads and validation still apply.
export function shouldResumeMealLogging(message: string, reply: string) {
  const text = message.trim().toLowerCase().replace(/[’]/g, "'");
  if (
    /\b(don't|do not|not to|never)\s+(save|log|record)|\b(preview|hypothetical|example|tomorrow|planning|plan to|going to|my friend|my partner|my child|might|would|should|advice only|just asking|only asking)\b/.test(
      text,
    )
  )
    return false;
  const report =
    /^(?:i\s+(?:(?:just|also|already)\s+)?(?:ate|eaten|drank|drunk)\b|also\s+(?:ate|eat|had|drank)\b|(?:please\s+)?(?:log|record|save|add)\b[^\n]{0,90}\b(?:meal|breakfast|lunch|dinner|snack|food|eggs?|coffee)\b|(?:for\s+)?(?:breakfast|lunch|dinner|snack)\s*[:,—-]?\s+i\s+(?:had|ate)\b)/.test(
      text,
    );
  return (
    report &&
    /before\s+(?:i\s+)?sav(?:e|ing)|(?:need|confirm|clarify|waiting)[\s\S]{0,90}(?:portion|whole|everything|meat|ate|eaten)|did you eat (?:the |it )?(?:whole|all|everything)/i.test(
      reply,
    )
  );
}
