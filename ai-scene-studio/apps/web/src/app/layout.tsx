import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { AuthProvider } from '@/components/AuthProvider';
import { CommandPalette } from '@/components/CommandPalette';
import { Toaster } from '@/components/Toaster';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Chagomi',
  description: 'Plateforme de production de films IA : du script au film.',
  icons: { icon: '/brand/favicon-chagomi.png' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={jakarta.variable} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <script
          // Thème mémorisé appliqué avant l'affichage (pas de flash).
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('ass.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
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
