import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const patterns = await prisma.excludedPattern.findMany({
    orderBy: { pattern: "asc" },
  });
  return NextResponse.json(patterns);
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const body = await request.json();
  const pattern = body.pattern?.trim();

  if (!pattern) {
    return NextResponse.json({ error: "Pattern is required" }, { status: 400 });
  }

  const existing = await prisma.excludedPattern.findUnique({
    where: { pattern },
  });
  if (existing) {
    return NextResponse.json({ error: "Pattern already exists" }, { status: 409 });
  }

  const created = await prisma.excludedPattern.create({
    data: { pattern },
  });

  return NextResponse.json(created, { status: 201 });
}
