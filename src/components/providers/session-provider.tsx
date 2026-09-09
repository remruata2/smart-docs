'use client';

import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';
import { ReactNode } from 'react';

interface AuthProviderProps {
  children: ReactNode;
  session?: Session | null;
}

export default function AuthProvider({ children, session }: AuthProviderProps) {
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false} refetchInterval={0}>
      {children}
    </SessionProvider>
  );
}
