import { NextResponse } from "next/server";

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function ok(data: unknown) {
  return NextResponse.json({ ok: true, data });
}
