import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountPanel } from "@/components/account-panel";
import { PageHeading } from "@/components/page-heading";
import { auth } from "@/lib/auth";
export const metadata: Metadata = { title: "Account" };
export default async function AccountPage() { const session = await auth.api.getSession({ headers: await headers() }); if (!session?.user) redirect("/sign-in"); return <><PageHeading title="Account" /><AccountPanel name={session.user.name} email={session.user.email} /></>; }
