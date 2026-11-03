import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { AuthProvider } from '@/components/AuthProvider';
import { CommandPalette } from '@/components/CommandPalette';
import { Toaster } from '@/components/Toaster';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Scene Studio',
  description: 'Conception d’images et de vidéos IA à partir d’une scène 3D persistante.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen font-sans antialiased">
        <AuthProvider>
          <AppHeader />
          <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
          <CommandPalette />
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
