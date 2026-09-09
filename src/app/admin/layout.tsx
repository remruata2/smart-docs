"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AdminSidebar from "@/components/layout/AdminSidebar";
import { Toaster } from "@/components/ui/sonner";
import "../../styles/lexical-editor-styles.css";

export default function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { data: session, status } = useSession();
	const router = useRouter();
	const [sidebarOpen, setSidebarOpen] = useState(false); // For mobile off-canvas

	useEffect(() => {
		if (status === "unauthenticated") {
			router.push("/login");
		}
	}, [status, router]);

	if (status === "unauthenticated") {
		return null;
	}

	return (
		<div className="min-h-screen bg-gray-100 flex">
			<Toaster richColors position="top-right" />
			{/* Static sidebar for desktop */}
			<div className="hidden lg:flex lg:flex-shrink-0">
				<div className="flex flex-col w-64">
					{/* Sidebar component, swap this element with another sidebar if you like */}
					<div className="flex flex-col h-0 flex-1 border-r border-gray-200 bg-white">
						<AdminSidebar />
					</div>
				</div>
			</div>

			{/* Mobile off-canvas sidebar */}
			{sidebarOpen && (
				<div className="lg:hidden fixed inset-0 z-40 flex">
					{/* Overlay */}
					<div
						className="fixed inset-0 bg-gray-600 bg-opacity-75"
						onClick={() => setSidebarOpen(false)}
					></div>
					{/* Sidebar */}
					<div className="relative flex-1 flex flex-col max-w-xs w-full bg-white">
						<div className="absolute top-0 right-0 -mr-12 pt-2">
							<button
								onClick={() => setSidebarOpen(false)}
								className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
							>
								<span className="sr-only">Close sidebar</span>
								<svg
									className="h-6 w-6 text-white"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>
						<AdminSidebar setSidebarOpen={setSidebarOpen} />
					</div>
					<div className="flex-shrink-0 w-14" aria-hidden="true">
						{/* Dummy element to force sidebar to shrink to fit close icon */}
					</div>
				</div>
			)}

			{/* Main content area */}
			<div className="flex flex-col w-0 flex-1 overflow-hidden">
				{/* Top bar for mobile (hamburger button) */}
				<div className="lg:hidden sticky top-0 z-30 flex-shrink-0 flex h-16 bg-white shadow">
					<button
						onClick={() => setSidebarOpen(true)}
						className="px-4 border-r border-gray-200 text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 lg:hidden"
					>
						<span className="sr-only">Open sidebar</span>
						<svg
							className="h-6 w-6"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M4 6h16M4 12h16M4 18h16"
							/>
						</svg>
					</button>
					<div className="flex-1 px-4 flex justify-between">
						<div className="flex-1 flex">
							{/* You can add a search bar here if needed */}
						</div>
						<div className="ml-4 flex items-center md:ml-6">
							{/* Profile dropdown or other icons can go here */}
						</div>
					</div>
				</div>

				<main className="flex-1 relative z-0 overflow-y-auto focus:outline-none py-2">
					<div className="w-full px-2">
						{children}
					</div>
				</main>
			</div>
		</div>
	);
}
