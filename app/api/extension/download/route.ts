import type { NextRequest } from "next/server";

const EXTENSION_VERSION = "0.1.31";

export async function GET(_request: NextRequest) {
  const filename = `xhs-browser-extension-${EXTENSION_VERSION}.zip`;

  return new Response(null, {
    status: 307,
    headers: { Location: `/downloads/${filename}` }
  });
}
