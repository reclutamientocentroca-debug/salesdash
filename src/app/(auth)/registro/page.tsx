import { redirect } from "next/navigation";
import FormularioRegistro from "@/components/auth/FormularioRegistro";
import { getSession } from "@/lib/tenant";

export const metadata = { title: "Crear cuenta · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaRegistro() {
  if (await getSession()) redirect("/dashboard");
  return <FormularioRegistro />;
}
