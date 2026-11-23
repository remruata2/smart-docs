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
            <Label htmlFor="username" className="text-sm font-medium">
              Username
            </Label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="pl-10 h-11 bg-background"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
            </div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                className="pl-10 pr-10 h-11 bg-background"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
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

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <input
                id="remember"
                name="remember"
                type="checkbox"
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary/20 accent-primary cursor-pointer"
                disabled={isLoading}
              />
              <Label
                htmlFor="remember"
                className="text-xs sm:text-sm font-normal text-muted-foreground cursor-pointer select-none"
              >
                Remember me for 30 days
              </Label>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-11 text-sm font-medium shadow-sm transition-all"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                Sign in
                <ArrowRight className="h-4 w-4 ml-1" />
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
