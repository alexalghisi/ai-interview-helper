"use client";

import { useParams } from "next/navigation";
import { AnswerFeed } from "@/components/answer-feed";

/**
 * Browser answer window. Identical to the phone view but counted separately, so
 * the control page can tell you a laptop window is attached. Open it on a
 * second monitor (or any window you are NOT sharing).
 */
export default function ViewerPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toUpperCase();

  return (
    <div className="min-h-dvh pt-2">
      <AnswerFeed code={code} role="viewer" />
    </div>
  );
}
