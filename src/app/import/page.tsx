import { redirect } from "next/navigation";
import { currentUserEmail } from "@/lib/auth";
import { ImportClient } from "./ImportClient";

export default async function ImportPage() {
  if (!(await currentUserEmail())) redirect("/login");
  return <ImportClient />;
}
