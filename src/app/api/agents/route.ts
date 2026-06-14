import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const agents = await prisma.agent.findMany({
      include: { reputation: true },
      orderBy: { type: "asc" },
    });

    return NextResponse.json<ApiResponse<typeof agents>>({
      success: true,
      data: agents,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: "Failed to fetch agents" },
      { status: 500 }
    );
  }
}
