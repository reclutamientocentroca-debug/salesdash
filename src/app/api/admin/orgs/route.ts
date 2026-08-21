import { NextResponse } from "next/server";
import { listarOrgs } from "@/lib/admin-db";
import { superadminApi } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await superadminApi();
  if (!s.ok) return s.respuesta;
  return NextResponse.json({ orgs: listarOrgs(s.ctx) });
}
