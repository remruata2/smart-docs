import React from "react";
import { FileText, ShieldCheck, Search, Zap } from "lucide-react";

export default function AuthBranding() {
  return (
    <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-slate-950 p-10 xl:p-14 text-white">
      {/* Background Decorative Gradients & Pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(59,130,246,0.25),rgba(255,255,255,0))]" />
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
      
      {/* Subtle Grid Pattern Overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)",
          backgroundSize: "24px 24px"
        }}
      />

      {/* Top Header / Logo */}
      <div className="relative z-10 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-lg shadow-blue-500/25">
          <FileText className="h-6 w-6 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
            SmartDocs
            <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400 border border-blue-500/20">
              AI
            </span>
          </span>
          <span className="text-xs text-slate-400">Knowledge & Intelligence</span>
        </div>
      </div>

      {/* Center Hero Content */}
      <div className="relative z-10 max-w-lg space-y-6 my-auto py-12">
        <div className="space-y-3">
          <h1 className="text-4xl xl:text-5xl font-extrabold tracking-tight text-white leading-[1.15]">
            SmartDocs
          </h1>
          <p className="text-lg text-slate-300 font-normal leading-relaxed">
            AI-powered document intelligence, semantic discovery, and investigation knowledge management.
          </p>
        </div>

        {/* Feature Highlights */}
        <div className="pt-4 grid grid-cols-1 gap-3.5">
          <div className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3 backdrop-blur-xs">
            <div className="rounded-md bg-blue-500/10 p-2 text-blue-400 border border-blue-500/20 shrink-0">
              <Search className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">Semantic & Vector Search</p>
              <p className="text-xs text-slate-400">Instantly surface key facts and entities across complex archives.</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3 backdrop-blur-xs">
            <div className="rounded-md bg-indigo-500/10 p-2 text-indigo-400 border border-indigo-500/20 shrink-0">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">AI Assistant & Chat</p>
              <p className="text-xs text-slate-400">Query files and datasets in natural language with source attribution.</p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3 backdrop-blur-xs">
            <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20 shrink-0">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">Enterprise Access Control</p>
              <p className="text-xs text-slate-400">Role-governed data protection, audit logs, and secure authentication.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Footer */}
      <div className="relative z-10 flex items-center justify-between text-xs text-slate-400 border-t border-white/10 pt-6">
        <span>SmartDocs</span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          System Operational
        </span>
      </div>
    </div>
  );
}
