"use client";

import { useParams } from "next/navigation";
import { AnswerFeed } from "@/components/answer-feed";

/**
 * Answer view. Works the same on a phone (scan the QR) and in a second browser
 * window on the laptop — both subscribe to the very same live relay.
 */
export default function AnswerPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toUpperCase();

  return (
    <div className="min-h-dvh pt-2">
      <AnswerFeed code={code} role="phone" />
    </div>
  );
}
