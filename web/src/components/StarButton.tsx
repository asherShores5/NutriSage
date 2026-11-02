import "./star.css";

/**
 * The Favorite star for one Library item (on Entries here; search results and the Library view
 * reuse it). Pressed means starred.
 */
export function StarButton({ name, starred, onToggle }: { name: string; starred: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`star${starred ? " starred" : ""}`}
      aria-pressed={starred}
      aria-label={starred ? `Unstar ${name}` : `Star ${name}`}
      title={starred ? "Remove from Quick Add" : "Add to Quick Add"}
      onClick={onToggle}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}
