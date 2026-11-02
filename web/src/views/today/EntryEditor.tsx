import type { Entry } from "@nutrisage/shared";

/**
 * Edit one Entry, opened from the Entry list. Ticket 04: delete. Amount and unit (05) and moving to
 * another Meal or Day (06) add their controls here and save through `onChange`.
 */
export function EntryEditor({ entry, onDelete, onClose }: {
  entry: Entry;
  onChange: (entry: Entry) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="entry-editor" role="group" aria-label={`Edit ${entry.name}`}>
      <div className="entry-editor-actions">
        <button type="button" className="danger" onClick={onDelete}>Delete</button>
        <button type="button" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
