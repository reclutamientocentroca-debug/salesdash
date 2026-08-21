import { redirect } from "next/navigation";
import { getSession } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function Inicio() {
  const ctx = await getSession();
  redirect(ctx ? "/dashboard" : "/login");
}
