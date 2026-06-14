import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { runIndexerCycle } from "@/services/indexer/indexer.service";

export async function POST(req: NextRequest) {
  // Simple token auth for admin actions
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${config.ADMIN_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runIndexerCycle();
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
