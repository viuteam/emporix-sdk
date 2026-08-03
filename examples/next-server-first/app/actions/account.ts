"use server";

import { revalidatePath } from "next/cache";
import type { AuthContext, EmporixClient } from "@viu/emporix-sdk";
import { withEmporixSessionMutable } from "@viu/emporix-sdk-next/session";
import { EMPORIX } from "../emporix";
import { describeError } from "../lib/describe-error";
import type { ActionState } from "../components/action-form";
import { missingField, readAddress } from "../lib/address-fields";

/**
 * Profile fields, measured rather than guessed: `firstName`, `lastName`,
 * `contactEmail`, `contactPhone` — read off
 * `storefront-demo/src/account/ProfileForm.tsx`, which runs against the real
 * tenant. `email` exists on the shape and is empty.
 */
export async function updateProfile(_state: ActionState, form: FormData): Promise<ActionState> {
  const firstName = String(form.get("firstName")).trim();
  const lastName = String(form.get("lastName")).trim();
  if (firstName === "" || lastName === "") return { error: "First and last name are required." };
  const contactEmail = String(form.get("contactEmail") ?? "").trim();
  const contactPhone = String(form.get("contactPhone") ?? "").trim();

  try {
    await withEmporixSessionMutable(
      // All four fields go out, empty ones included. Skipping the empty ones was
      // the first version and it was wrong: this form always submits all four, so
      // «empty» means the shopper cleared it — and a mistyped phone number could
      // never be removed. Skipping is right for a partial patch, not for a form
      // that shows every field it owns.
      (client, ctx) =>
        client.customers.update({ firstName, lastName, contactEmail, contactPhone }, ctx),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account");
  revalidatePath("/account/profile");
  return { error: null };
}

/**
 * `currentPassword`, not `oldPassword`. Measured against
 * `storefront-demo/src/account/PasswordForm.tsx:23`, where the call is live —
 * the wrong name yields a 400 whose body does not say which field it meant.
 */
export async function changePassword(_state: ActionState, form: FormData): Promise<ActionState> {
  const currentPassword = String(form.get("currentPassword"));
  const newPassword = String(form.get("newPassword"));
  if (newPassword.length < 8) return { error: "The new password needs at least 8 characters." };
  if (newPassword === currentPassword) return { error: "That is the current password." };

  try {
    await withEmporixSessionMutable(
      (client, ctx) => client.customers.changePassword({ currentPassword, newPassword }, ctx),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  // Nothing to revalidate: no rendered value changed.
  return { error: null };
}

/** The shared frame for the three address mutations. */
async function mutateAddresses(
  fn: (client: EmporixClient, ctx: AuthContext) => Promise<unknown>,
): Promise<ActionState> {
  try {
    await withEmporixSessionMutable((client, ctx) => fn(client, ctx), EMPORIX);
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/addresses");
  return { error: null };
}

export async function addAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const address = readAddress(form);
  const problem = missingField(address);
  if (problem !== null) return { error: problem };
  return mutateAddresses((client, ctx) => client.customers.addresses.add(address, ctx));
}

export async function updateAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id"));
  const address = readAddress(form);
  const problem = missingField(address);
  if (problem !== null) return { error: problem };
  return mutateAddresses((client, ctx) => client.customers.addresses.update(id, address, ctx));
}

export async function deleteAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id"));
  return mutateAddresses((client, ctx) => client.customers.addresses.remove(id, ctx));
}
