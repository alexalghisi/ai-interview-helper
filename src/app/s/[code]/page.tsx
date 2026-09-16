import { getPublicState } from "@/lib/session-store";
import { PhoneView } from "./phone-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PhonePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = (code ?? "").toUpperCase();
  const initial = normalized ? (getPublicState(normalized) ?? null) : null;
  return <PhoneView code={normalized} initial={initial} />;
}
