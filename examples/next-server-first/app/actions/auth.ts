"use server";

import { revalidatePath } from "next/cache";
import { emporixLogin, emporixLogout } from "@viu/emporix-sdk-next/bff";
import { EMPORIX } from "../emporix";

export async function login(formData: FormData): Promise<void> {
  await emporixLogin(
    {
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    },
    EMPORIX,
  );
  revalidatePath("/", "layout");
}

export async function logout(): Promise<void> {
  await emporixLogout(EMPORIX);
  revalidatePath("/", "layout");
}
