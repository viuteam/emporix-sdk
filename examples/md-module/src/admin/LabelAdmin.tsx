import { useState } from "react";
import { useLabelMutations, useLabels } from "./useLabels";
import { ScopeError } from "./ScopeError";

/**
 * Label administration.
 *
 * Four states rendered explicitly — pending, error, empty, table — because the
 * error state is the one a dashboard operator hits and the empty one is
 * indistinguishable from a broken read if you skip it.
 *
 * Nothing here refetches after a write: the mutation bundle invalidates
 * `["emporix", "labels"]` and the table follows.
 */
export function LabelAdmin(): React.JSX.Element {
  const labels = useLabels({ pageSize: 50 });
  const m = useLabelMutations();
  const [name, setName] = useState("");
  const busy = m.create.isPending || m.remove.isPending || m.update.isPending;

  const rows = (labels.data ?? []) as Array<{ id?: string; name?: string }>;
  const writeError = m.create.error ?? m.update.error ?? m.remove.error;

  return (
    <section>
      <h1>Labels</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (trimmed === "") return;
          m.create.mutate({ name: trimmed } as never, { onSuccess: () => setName("") });
        }}
      >
        <input
          type="text"
          value={name}
          placeholder="Label name"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {m.create.isPending ? "Saving…" : "Create"}
        </button>
      </form>

      {writeError !== null && writeError !== undefined ? (
        <>
          <ScopeError error={writeError} />
          <p role="alert">{String(writeError)}</p>
        </>
      ) : null}

      {labels.isPending ? (
        <p>Loading…</p>
      ) : labels.isError ? (
        <>
          <ScopeError error={labels.error} />
          <p role="alert">{String(labels.error)}</p>
        </>
      ) : rows.length === 0 ? (
        <p>No labels on this tenant yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Id</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>{b.name ?? "(unnamed)"}</td>
                <td>
                  <code>{b.id}</code>
                </td>
                <td>
                  <button
                    type="button"
                    disabled={busy || b.id === undefined}
                    onClick={() => m.remove.mutate(b.id as string)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
