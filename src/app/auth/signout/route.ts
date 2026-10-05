import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (auth) await auth.signOut();
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
}
