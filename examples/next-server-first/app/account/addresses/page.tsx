import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { EMPORIX } from "../../emporix";
import { requireCustomer } from "../../lib/require-customer";
import { ActionForm } from "../../components/action-form";
import { ADDRESS_FIELDS } from "../../lib/address-fields";
import { addAddress, deleteAddress, updateAddress } from "../../actions/account";

/**
 * Address CRUD through Server Actions — the pattern the returns, rewards and
 * shopping-list pages would repeat, which is why the README lists those three as
 * deliberate non-goals rather than gaps.
 *
 * Each address is its own `ActionForm`, so an error on one does not clear the
 * others: `useActionState` keeps its state per component instance.
 */
export default async function AddressesPage(): Promise<React.JSX.Element> {
  await requireCustomer("/account/addresses");
  const addresses = await withEmporixSession(
    (client, ctx) => client.customers.addresses.list(ctx),
    EMPORIX,
  );

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">
        <a href="/account" className="u-underline">
          ← Account
        </a>
      </p>
      <h1 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        Addresses
      </h1>

      {addresses.length === 0 ? (
        <p className="muted">No addresses yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {addresses.map((a) => {
            // No cast: `Address` is a properly typed generated shape and every
            // name in ADDRESS_FIELDS is a key on it. The first version cast to
            // `Record<string, string | undefined>` and the compiler refused —
            // `isDefault` is a boolean. It was right to refuse.
            const id = a.id ?? "";
            return (
              <li key={id} className="surface" style={{ marginBottom: "var(--s-4)" }}>
                <ActionForm action={updateAddress} submit="Save">
                  <input type="hidden" name="id" value={id} />
                  {ADDRESS_FIELDS.map((f) => (
                    <span key={f.name} style={{ display: "block" }}>
                      <label className="field__label" htmlFor={`${id}-${f.name}`}>
                        {f.label}
                      </label>
                      <input
                        id={`${id}-${f.name}`}
                        className="input"
                        name={f.name}
                        defaultValue={a[f.name] ?? ""}
                      />
                    </span>
                  ))}
                </ActionForm>
                <ActionForm action={deleteAddress} submit="Delete">
                  <input type="hidden" name="id" value={id} />
                </ActionForm>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="serif" style={{ marginTop: "var(--s-6)" }}>
        New address
      </h2>
      <ActionForm action={addAddress} submit="Add">
        {ADDRESS_FIELDS.map((f) => (
          <span key={f.name} style={{ display: "block" }}>
            <label className="field__label" htmlFor={`new-${f.name}`}>
              {f.label}
            </label>
            <input id={`new-${f.name}`} className="input" name={f.name} />
          </span>
        ))}
      </ActionForm>
    </main>
  );
}
