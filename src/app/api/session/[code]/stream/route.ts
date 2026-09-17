import {
  COOKIE_NAME,
  authRequiredForRequest,
  cookieFromRequest,
  verifyToken,
} from "@/lib/auth";
import {
  getSession,
  subscribe,
  type SubscriberRole,
  type ServerEvent,
} from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/**
 * SSE relay: a phone (or any viewer) connects here and receives live events
 * for the session — snapshots, streaming answer deltas, and status changes.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  if (authRequiredForRequest(req)) {
    const token = cookieFromRequest(req, COOKIE_NAME);
    if (!(await verifyToken(token))) {
      return new Response("Unauthorized — sign in first.", { status: 401 });
    }
  }

  const { code } = await params;
  const session = getSession(code);
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  const url = new URL(req.url);
  const role: SubscriberRole =
    url.searchParams.get("role") === "control" ? "control" : "phone";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: ServerEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      const unsubscribe = subscribe(code, send, role);
      if (!unsubscribe) {
        controller.close();
        return;
      }

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          clearInterval(keepAlive);
        }
      }, 5000);

      const close = () => {
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "none",
    },
  });
}
