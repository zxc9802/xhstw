"use client";

import { useEffect } from "react";
import { createLibrary2ExtensionSession } from "@/lib/content-library-2/client";

export const LIBRARY2_SESSION_CHANNEL = "content-production-studio.library2";

export function Library2SessionBridge() {
  useEffect(() => {
    let cancelled = false;
    void createLibrary2ExtensionSession()
      .then((session) => {
        if (cancelled) return;
        window.postMessage({
          channel: LIBRARY2_SESSION_CHANNEL,
          type: "session",
          token: session.token,
          expiresAt: session.expiresAt,
          appOrigin: window.location.origin
        }, window.location.origin);
      })
      .catch(() => {
        // The page still works without the plugin; the plugin will ask the user to reopen the workbench.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
