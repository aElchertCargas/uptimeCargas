import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { validateMonitorInput } from "@/lib/validation";

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const monitors = await prisma.monitor.findMany({
    include: {
      checks: {
        orderBy: { checkedAt: "desc" },
        take: 1,
      },
      _count: {
        select: { checks: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(monitors);
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const body = await request.json();
  let input;
  try {
    input = validateMonitorInput(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid monitor" },
      { status: 400 }
    );
  }

  const monitor = await prisma.monitor.create({
    data: {
      ...input,
    },
  });

  return NextResponse.json(monitor, { status: 201 });
}
