import { redirect } from "next/navigation";
import FormularioLogin from "@/components/auth/FormularioLogin";
import { getSession } from "@/lib/tenant";

export const metadata = { title: "Entrar · SalesDash" };
export const dynamic = "force-dynamic";

export default async function PaginaLogin() {
  // Con sesión abierta no tiene sentido mostrar el formulario.
  if (await getSession()) redirect("/dashboard");
  return <FormularioLogin />;
}
