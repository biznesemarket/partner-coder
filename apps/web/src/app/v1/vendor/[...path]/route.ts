import type { NextRequest } from "next/server";

import { jsonError, proxyVendorRequest } from "@/lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const apiBaseUrl = process.env.API_BASE_URL;

  if (!apiBaseUrl) {
    return jsonError(502, "upstream_unavailable", "Сервис временно недоступен");
  }

  return proxyVendorRequest(request, path, {
    apiBaseUrl,
    targetPathPrefix: "/v1/vendor",
  });
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST };
