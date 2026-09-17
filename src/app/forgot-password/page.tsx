import type { Metadata } from "next";
import { RequestResetForm } from "@/components/password-reset-form";
export const metadata: Metadata = { title: "Reset password" };
export default function ForgotPasswordPage() { return <RequestResetForm />; }
