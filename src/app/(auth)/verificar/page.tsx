import { redirect } from "next/navigation";
import FormularioVerificar from "@/components/auth/FormularioVerificar";
import { getSession } from "@/lib/tenant";

export const metadata = { title: "Confirma tu correo · SalesDash" };
export const dynamic = "force-dynamic";

// En Next 16 los searchParams llegan como promesa.
interface Props {
  searchParams: Promise<{ correo?: string }>;
}

export default async function PaginaVerificar({ searchParams }: Props) {
  if (await getSession()) redirect("/dashboard");

  const { correo } = await searchParams;
  // Sin correo no hay nada que verificar: se vuelve al principio.
  if (!correo) redirect("/registro");

  return <FormularioVerificar correo={correo} />;
}
