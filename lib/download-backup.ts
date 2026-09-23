import { today } from "./domain";

// Saves a JSON copy of the journal through a temporary download link.
export function downloadBackup(value: unknown, label = "backup") {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lift-journal-${label}-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
