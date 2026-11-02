import { expect, test } from '@playwright/test';

test('la page d’accueil s’affiche et rapporte l’état réel de l’API', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AI Scene Studio' })).toBeVisible();
  // Quel que soit l'état de l'API, la vérification doit aboutir à un résultat explicite.
  await expect(page.getByRole('status')).not.toHaveText(/Vérification en cours/, {
    timeout: 15_000,
  });
});
