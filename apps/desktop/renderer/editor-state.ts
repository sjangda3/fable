import {
  Annotation,
  EditorState,
  Transaction,
  EditorSelection,
} from "@codemirror/state";
export const external = Annotation.define<boolean>();
export const frontmatterBoundary = (text: string) =>
  /^(?:\uFEFF)?---\n(?:[\s\S]*?\n)?---(?:\n|$)/.exec(text)?.[0].length ?? 0;

/** Select-all in live preview operates on visible content, never hidden properties. */
export const protectFrontmatter = EditorState.transactionFilter.of(
  (transaction) => {
    if (transaction.annotation(external)) return transaction;
    const boundary = frontmatterBoundary(transaction.startState.doc.toString());
    if (!boundary) return transaction;
    if (!transaction.docChanged) {
      if (
        transaction.newSelection.ranges.some((range) => range.from < boundary)
      )
        return {
          selection: EditorSelection.create(
            transaction.newSelection.ranges.map((range) =>
              EditorSelection.range(
                Math.max(boundary, range.anchor),
                Math.max(boundary, range.head),
              ),
            ),
            transaction.newSelection.mainIndex,
          ),
        };
      return transaction;
    }
    const changes: { from: number; to: number; insert: string }[] = [];
    let touchesHidden = false;
    transaction.changes.iterChanges((from, to, _fromNew, _toNew, insert) => {
      if (from < boundary) {
        touchesHidden = true;
        if (to < boundary) return;
        from = boundary;
      }
      changes.push({ from, to, insert: insert.toString() });
    });
    if (!touchesHidden) return transaction;
    const length =
      transaction.startState.doc.length +
      changes.reduce((n, c) => n + c.insert.length - (c.to - c.from), 0);
    return {
      changes,
      selection: {
        anchor: Math.min(
          length,
          changes.length
            ? changes[0].from + changes[0].insert.length
            : boundary,
        ),
      },
      annotations: Transaction.userEvent.of(
        transaction.annotation(Transaction.userEvent) ?? "input",
      ),
    };
  },
);
