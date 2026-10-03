import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, createSupabaseServerClient } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (authConfigured) await (await createSupabaseServerClient()).auth.signOut();
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
}
