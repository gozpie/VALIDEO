import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Sortie autonome uniquement pour l'image Docker (incompatible avec `next start`).
  ...(process.env['NEXT_OUTPUT'] === 'standalone' ? { output: 'standalone' as const } : {}),
  // Les packages internes sont publiés en TypeScript source.
  transpilePackages: [
    '@ass/animation-engine',
    '@ass/api-client',
    '@ass/editor-ui',
    '@ass/scene-engine',
    '@ass/scene-schema',
    '@ass/shared-types',
    '@valideo/audio-engine',
    '@valideo/command-system',
    '@valideo/demux',
    '@valideo/keyboard',
    '@valideo/playback',
    '@valideo/project-model',
    '@valideo/shared',
    '@valideo/time-core',
    '@valideo/timeline-engine',
    '@valideo/timeline-model',
  ],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
