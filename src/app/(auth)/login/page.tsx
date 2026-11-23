"use client";

import { AuthBranding, LoginForm } from "@/components/auth";

export default function LoginPage() {
	return (
		<main className="min-h-screen w-full grid lg:grid-cols-2 bg-background">
			{/* Left section: SmartDocs branding and description */}
			<AuthBranding />

			{/* Right section: Login form */}
			<div className="flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-slate-50/60 dark:bg-slate-900/40">
				<LoginForm />
			</div>
		</main>
	);
}

