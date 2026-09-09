"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserRole } from "@/generated/prisma";

interface AdminSidebarProps {
  setSidebarOpen?: (open: boolean) => void;
}

export default function AdminSidebar({ setSidebarOpen }: AdminSidebarProps) {
  const { data: session } = useSession();
  const pathname = usePathname();

  const baseLinkClasses =
    "flex items-center px-3 py-2 text-sm font-medium rounded-md";
  const activeLinkClasses = "bg-gray-200 text-gray-900";
  const inactiveLinkClasses =
    "text-gray-700 hover:bg-gray-100 hover:text-gray-900";

  return (
    // This is the actual sidebar panel content
    <div className="flex flex-col h-screen sticky top-0 w-full bg-white shadow-xl overflow-y-auto">
      {/* Brand Header */}
      <div className="flex-shrink-0 flex items-center gap-2.5 px-4 py-4 border-b border-gray-200 bg-slate-50/70">
        <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
          SD
        </div>
        <div>
          <h2 className="text-base font-bold text-gray-900 tracking-tight leading-tight">Smart Docs</h2>
          <p className="text-[11px] text-gray-500 font-medium">Document Intelligence</p>
        </div>
      </div>

      {/* User info */}
      <div className="flex-shrink-0 flex items-center px-4 py-3.5 border-b border-gray-200">
        <div className="flex-shrink-0 group block">
          <div className="flex items-center">
            <div className="h-8 w-8 rounded-full bg-gray-300 flex items-center justify-center">
              <span className="text-sm font-medium text-gray-700">
                {session?.user.username?.charAt(0).toUpperCase() || "U"}
              </span>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">
                {session?.user.username || "User"}
              </p>
              <p className="text-xs font-medium text-gray-500">
                {session?.user.role}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        <Link
          href="/admin"
          onClick={() => setSidebarOpen && setSidebarOpen(false)}
          className={`${baseLinkClasses} ${
            pathname === "/admin" ? activeLinkClasses : inactiveLinkClasses
          }`}
        >
          <svg
            className="mr-3 h-5 w-5 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          Dashboard
        </Link>

        {session?.user.role === UserRole.admin && (
          <Link
            href="/admin/users"
            onClick={() => setSidebarOpen && setSidebarOpen(false)}
            className={`${baseLinkClasses} ${
              pathname.startsWith("/admin/users")
                ? activeLinkClasses
                : inactiveLinkClasses
            }`}
          >
            <svg
              className="mr-3 h-5 w-5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
            User Management
          </Link>
        )}

        {(session?.user.role === UserRole.admin || session?.user.role === UserRole.staff) && (
          <Link
            href="/admin/categories"
            onClick={() => setSidebarOpen && setSidebarOpen(false)}
            className={`${baseLinkClasses} ${
              pathname.startsWith("/admin/categories")
                ? activeLinkClasses
                : inactiveLinkClasses
            }`}
          >
            {/* You can replace this SVG with a more relevant one for categories if desired */}
            <svg
              className="mr-3 h-5 w-5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            Categories
          </Link>
        )}

        {(session?.user.role === UserRole.admin || session?.user.role === UserRole.staff) && (
          <Link
            href="/admin/files"
            onClick={() => setSidebarOpen && setSidebarOpen(false)}
            className={`${baseLinkClasses} ${
              pathname.startsWith("/admin/files")
                ? activeLinkClasses
                : inactiveLinkClasses
            }`}
          >
            {/* Icon for Files - using a generic document/folder icon */}
            <svg
              className="mr-3 h-5 w-5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            Manage Files
          </Link>
        )}

        {session?.user.role === UserRole.admin && (
          <Link
            href="/admin/chat"
            onClick={() => setSidebarOpen && setSidebarOpen(false)}
            className={`${baseLinkClasses} ${
              pathname.startsWith("/admin/chat")
                ? activeLinkClasses
                : inactiveLinkClasses
            }`}
          >
            {/* Icon for AI Chat - using a chat/message icon */}
            <svg
              className="mr-3 h-5 w-5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            AI Assistant
          </Link>
        )}

        {session?.user.role === UserRole.admin && (
          <div className="mt-6">
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Settings
            </div>
            <div className="space-y-1">
              <Link
                href="/admin/settings/ai-models"
                onClick={() => setSidebarOpen && setSidebarOpen(false)}
                className={`${baseLinkClasses} ${
                  pathname.startsWith("/admin/settings/ai-models")
                    ? activeLinkClasses
                    : inactiveLinkClasses
                }`}
              >
                {/* Icon for Models - layers */}
                <svg
                  className="mr-3 h-5 w-5 text-gray-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4l8 4-8 4-8-4 8-4zm0 8l8 4-8 4-8-4 8-4z"
                  />
                </svg>
                AI Models
              </Link>

              <Link
                href="/admin/settings/ai-keys"
                onClick={() => setSidebarOpen && setSidebarOpen(false)}
                className={`${baseLinkClasses} ${
                  pathname.startsWith("/admin/settings/ai-keys")
                    ? activeLinkClasses
                    : inactiveLinkClasses
                }`}
              >
                {/* Icon for API Keys - key */}
                <svg
                  className="mr-3 h-5 w-5 text-gray-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 7a3 3 0 11-6 0 3 3 0 016 0zM13.5 9.5L21 17l-2 2-1-1-2 2-2-2 2-2-2-2 1.5-1.5z"
                  />
                </svg>
                AI API Keys
              </Link>

              <Link
                href="/admin/settings/ai-config"
                onClick={() => setSidebarOpen && setSidebarOpen(false)}
                className={`${baseLinkClasses} ${
                  pathname.startsWith("/admin/settings/ai-config")
                    ? activeLinkClasses
                    : inactiveLinkClasses
                }`}
              >
                {/* Icon for Settings - cog */}
                <svg
                  className="mr-3 h-5 w-5 text-gray-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11.049 2.927c.3-1.14 1.99-1.14 2.29 0a1.724 1.724 0 002.573 1.066c1.003-.58 2.194.61 1.614 1.614a1.724 1.724 0 001.066 2.573c1.14.3 1.14 1.99 0 2.29a1.724 1.724 0 00-1.066 2.573c.58 1.003-.61 2.194-1.614 1.614a1.724 1.724 0 00-2.573 1.066c-.3 1.14-1.99 1.14-2.29 0a1.724 1.724 0 00-2.573-1.066c-1.003.58-2.194-.61-1.614-1.614a1.724 1.724 0 00-1.066-2.573c-1.14-.3-1.14-1.99 0-2.29.86-.226 1.53-.896 1.756-1.756.58-1.003 1.77-2.194 2.773-1.614.994.575 1.78-.211 2.356-.205z"
                  />
                </svg>
                AI Search Settings
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* Sign Out Button */}
      <div className="flex-shrink-0 px-4 py-4 border-t border-gray-200">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          <svg
            className="mr-2 h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
          Sign out
        </button>
      </div>
    </div>
  );
}
