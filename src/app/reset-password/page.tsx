import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/password-reset-form";
export const metadata: Metadata = { title: "Choose new password" };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) { const { token } = await searchParams; return <ResetPasswordForm token={typeof token === "string" ? token : null} />; }
