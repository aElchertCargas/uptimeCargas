import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

interface ApiCustomer {
  customerName: string;
  publicUrl: string;
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

function normalizeCustomerName(name: string): string {
  return name.trim().toLowerCase();
}

function matchesPattern(pattern: string, name: string, url: string): boolean {
  const p = pattern.toLowerCase();
  const n = name.toLowerCase();
  const u = url.toLowerCase();

  if (u.includes(p) || n.includes(p)) return true;
  if (p.startsWith("http") && normalizeUrl(p) === normalizeUrl(url)) return true;

  return false;
}

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const apiUrl = process.env.ENERGY_API_URL;
  const apiKey = process.env.ENERGY_API_KEY;

  if (!apiUrl || !apiKey) {
    return NextResponse.json(
      { error: "ENERGY_API_URL and ENERGY_API_KEY must be configured" },
      { status: 500 }
    );
  }

  let customers: ApiCustomer[];
  try {
    const res = await fetch(apiUrl, {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    customers = await res.json();
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch customers: ${error instanceof Error ? error.message : "Unknown"}` },
      { status: 502 }
    );
  }

  const validCustomers = customers.filter(
    (c) => c.publicUrl && c.publicUrl.trim() && !c.publicUrl.includes("[")
  );

  const [monitors, excludedPatterns] = await Promise.all([
    prisma.monitor.findMany({ select: { id: true, name: true, url: true } }),
    prisma.excludedPattern.findMany(),
  ]);

  const monitorUrlSet = new Set(monitors.map((m) => normalizeUrl(m.url)));
  const customerUrlSet = new Set(validCustomers.map((c) => normalizeUrl(c.publicUrl)));
  const customerUrlsByName = new Map<string, Map<string, string>>();

  for (const customer of validCustomers) {
    const customerName = normalizeCustomerName(customer.customerName);
    const customerUrls = customerUrlsByName.get(customerName) ?? new Map<string, string>();

    customerUrls.set(normalizeUrl(customer.publicUrl), customer.publicUrl);
    customerUrlsByName.set(customerName, customerUrls);
  }

  const excluded: { customerName: string; publicUrl: string; matchedPattern: string }[] = [];
  const toAdd: { customerName: string; publicUrl: string }[] = [];
  const urlMismatches: {
    id: string;
    customerName: string;
    currentUrl: string;
    syncedUrl: string;
  }[] = [];
  const mismatchMonitorIds = new Set<string>();
  const mismatchCustomerNames = new Set<string>();

  for (const monitor of monitors) {
    const customerUrls = customerUrlsByName.get(normalizeCustomerName(monitor.name));

    if (!customerUrls || customerUrls.has(normalizeUrl(monitor.url))) {
      continue;
    }

    const syncedUrl = customerUrls.values().next().value;

    if (!syncedUrl) {
      continue;
    }

    urlMismatches.push({
      id: monitor.id,
      customerName: monitor.name,
      currentUrl: monitor.url,
      syncedUrl,
    });
    mismatchMonitorIds.add(monitor.id);
    mismatchCustomerNames.add(normalizeCustomerName(monitor.name));
  }

  for (const customer of validCustomers) {
    const norm = normalizeUrl(customer.publicUrl);
    const customerName = normalizeCustomerName(customer.customerName);

    if (monitorUrlSet.has(norm)) continue;
    if (mismatchCustomerNames.has(customerName)) continue;

    const match = excludedPatterns.find((p) =>
      matchesPattern(p.pattern, customer.customerName, customer.publicUrl)
    );

    if (match) {
      excluded.push({
        customerName: customer.customerName,
        publicUrl: customer.publicUrl,
        matchedPattern: match.pattern,
      });
    } else {
      toAdd.push({
        customerName: customer.customerName,
        publicUrl: customer.publicUrl,
      });
    }
  }

  const toDelete = monitors.filter(
    (m) => !customerUrlSet.has(normalizeUrl(m.url)) && !mismatchMonitorIds.has(m.id)
  );

  return NextResponse.json({
    toAdd,
    toDelete,
    excluded,
    urlMismatches,
    summary: {
      totalCustomers: validCustomers.length,
      totalMonitors: monitors.length,
      toAddCount: toAdd.length,
      toDeleteCount: toDelete.length,
      excludedCount: excluded.length,
      urlMismatchCount: urlMismatches.length,
    },
  });
}
