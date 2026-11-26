"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Lock, User, AlertCircle, FileText, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        redirect: false,
        username,
        password,
      });

      if (result?.error) {
        setError("Invalid username or password");
        setIsLoading(false);
        return;
      }

      // Successful login - redirect to admin dashboard
      router.replace("/admin");
    } catch (err) {
      console.error("Login error:", err);
      setError("An error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-col justify-center px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-12">
      <div className="mx-auto w-full max-w-sm sm:max-w-md space-y-8">
        {/* Mobile Header (shown only when left branding is hidden on small screens) */}
        <div className="lg:hidden flex flex-col items-center text-center space-y-2 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-md shadow-blue-500/20 text-white">
            <FileText className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">SmartDocs</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              AI-powered document intelligence & knowledge management
            </p>
          </div>
        </div>

        {/* Form Title & Description */}
        <div className="space-y-2 text-center lg:text-left">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            Sign in
          </h2>
          <p className="text-sm text-muted-foreground">
            Enter your credentials to access your workspace
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div 
            role="alert" 
            className="p-3.5 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2.5 text-destructive text-sm animate-in fade-in-50 duration-200"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Username
            </Label>
            <div className="group relative flex items-center rounded-xl bg-slate-50/90 dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800 transition-all duration-200 focus-within:border-blue-500 focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:shadow-xs hover:border-slate-300 dark:hover:border-slate-700">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-600 dark:group-focus-within:text-blue-400 transition-colors pointer-events-none" />
              <Input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="h-12 w-full rounded-xl bg-transparent pl-10 pr-4 text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 placeholder:font-normal outline-none border-0 shadow-none focus-visible:ring-0 focus-visible:border-transparent"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Password
              </Label>
            </div>
            <div className="group relative flex items-center rounded-xl bg-slate-50/90 dark:bg-slate-900/60 border border-slate-200/90 dark:border-slate-800 transition-all duration-200 focus-within:border-blue-500 focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:shadow-xs hover:border-slate-300 dark:hover:border-slate-700">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-600 dark:group-focus-within:text-blue-400 transition-colors pointer-events-none" />
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                className="h-12 w-full rounded-xl bg-transparent pl-10 pr-11 text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 placeholder:font-normal outline-none border-0 shadow-none focus-visible:ring-0 focus-visible:border-transparent"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center space-x-2.5">
              <input
                id="remember"
                name="remember"
                type="checkbox"
                className="h-4 w-4 rounded-md border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500/20 accent-blue-600 cursor-pointer transition-colors"
                disabled={isLoading}
              />
              <Label
                htmlFor="remember"
                className="text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
              >
                Remember me for 30 days
              </Label>
            </div>
          </div>

          <Button
            type="submit"
            className="group relative w-full h-12 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:via-indigo-500 hover:to-blue-600 shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] border-t border-white/20 transition-all duration-200 disabled:opacity-60 disabled:pointer-events-none disabled:transform-none"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-white" />
                <span>Signing in...</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 font-semibold">
                <span>Sign in</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </span>
            )}
          </Button>
        </form>

        {/* Security & Access Notice */}
        <div className="border-t border-border pt-6 text-center">
          <p className="text-xs text-muted-foreground">
            Authorized personnel only. Sessions are encrypted and audited.
          </p>
        </div>
      </div>
    </div>
  );
}
