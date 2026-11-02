import { CURRENT_SCHEMA_VERSION } from '@ass/scene-schema';
import { ApiStatus } from '@/components/ApiStatus';
import { API_URL } from '@/lib/config';

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <header>
        <h1 className="text-2xl font-semibold">AI Scene Studio</h1>
        <p className="mt-2 text-sm text-muted">
          Environnement de développement — phase 0. L’éditeur de scène sera disponible à partir de
          la phase 2. Format de scène : v{CURRENT_SCHEMA_VERSION}.
        </p>
      </header>
      <ApiStatus apiUrl={API_URL} />
    </main>
  );
}
