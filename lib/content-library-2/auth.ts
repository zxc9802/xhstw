import type { NextRequest } from "next/server";
import { requireContentStorageOwner } from "@/lib/content-storage/auth";
import { verifyLibrary2ExtensionToken } from "./extension-token";

export async function requireLibrary2Owner(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return verifyLibrary2ExtensionToken(header.slice(7).trim()).ownerId;
  }
  return requireContentStorageOwner(request);
}
