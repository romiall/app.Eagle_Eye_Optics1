import { expect, type Locator, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'

/**
 * Mise en page des formulaires, MESURÉE dans le navigateur (le CSS ne se vérifie pas en jsdom) : un
 * bouton posé à côté d'un champ reste aligné sur la saisie, avec ou sans aide sous elle, à 768 et
 * 1280 px ; sous 640 px la rangée est empilée et le champ garde sa largeur ; les icônes et le
 * chevron des champs ont leur remplissage (l'ordre du CSS généré arbitre px-3 et pl-10 / pr-10). Le
 * contrat de base.css est en plus lu par tests/frontend/shell/form-styles.test.ts.
 */

async function signIn(page: Page, role: string): Promise<void> {
  const account = demoAccount(role)
  await page.goto('/connexion')
  await page.getByLabel('Identifiant').fill(account.login)
  await page.getByLabel('Mot de passe').fill(account.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function box(locator: Locator, what: string): Promise<Box> {
  await expect(locator, what).toBeVisible()
  const found = await locator.boundingBox()
  if (found === null) throw new Error(`${what} : aucune position`)
  return found
}

const center = (found: Box): number => found.y + found.height / 2

/** Le centre vertical du bouton est celui de la saisie, à 2 px près. */
async function expectAligned(
  page: Page,
  input: Locator,
  button: Locator,
  what: string,
): Promise<void> {
  const field = await box(input, `${what} : saisie`)
  const action = await box(button, `${what} : bouton`)
  expect(
    Math.abs(center(field) - center(action)),
    `${what} à ${page.viewportSize()?.width} px : bouton et saisie alignés`,
  ).toBeLessThanOrEqual(2)
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

test.describe('mise en page des formulaires (mesures dans le navigateur)', () => {
  test('un bouton posé à côté d’un champ est aligné sur la saisie à 768 et 1280 px', async ({
    page,
  }) => {
    await signIn(page, 'MANAGER')

    for (const width of [768, 1280]) {
      await page.setViewportSize({ width, height: 900 })

      // Rangées flex avec `.field-action` : recherche de patients, caisse du jour.
      await page.goto('/patients')
      await expectAligned(
        page,
        page.getByRole('searchbox', { name: 'Rechercher un patient' }),
        page.getByRole('button', { name: 'Rechercher' }),
        'liste des patients',
      )
      await page.goto('/ventes/caisse-du-jour')
      const day = page.locator('#caisse-jour-date')
      await expectAligned(
        page,
        day,
        page.getByRole('button', { name: 'Afficher' }),
        'caisse du jour',
      )
      await expectAligned(
        page,
        day,
        page.getByRole('button', { name: 'Aujourd’hui' }),
        'caisse du jour (Aujourd’hui)',
      )

      // Barres `.toolbar` : suivis et agenda (champ avec l'aide par défaut du DateField sous la saisie).
      await page.goto('/suivis')
      await expectAligned(
        page,
        page.locator('#suivis-jour'),
        page.getByRole('button', { name: 'Afficher' }),
        'suivis',
      )
      await page.goto('/agenda')
      await expectAligned(
        page,
        page.locator('#agenda-jour'),
        page.getByRole('button', { name: 'Afficher', exact: true }),
        'agenda',
      )
    }
  })

  test('« Aujourd’hui » : la date et « Actualiser la file » partagent une ligne, alignés sur la saisie, à toute largeur', async ({
    page,
  }) => {
    await signIn(page, 'MANAGER')

    for (const width of [768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/aujourdhui')
      const date = page.locator('#aujourdhui-jour')
      await expectAligned(
        page,
        date,
        page.getByRole('button', { name: 'Actualiser la file' }),
        'file du jour',
      )
      // Les trois boutons de navigation du jour sont sur leur propre ligne, au-dessus : aucun
      // décalage d'étiquette à leur donner, et rien ne se casse selon la largeur.
      const previous = await box(
        page.getByRole('button', { name: 'Jour précédent' }),
        'Jour précédent',
      )
      const field = await box(date, 'saisie du jour')
      expect(previous.y + previous.height, `navigation du jour à ${width} px`).toBeLessThanOrEqual(
        field.y,
      )
      expect(await horizontalOverflow(page), `débordement à ${width} px`).toBeLessThanOrEqual(0)
    }
  })

  test('exports : le bouton reste à côté de la liste à 768 px, sans décalage de ligne', async ({
    page,
  }) => {
    await signIn(page, 'MANAGER')
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto('/parametres/exports')

    await expectAligned(
      page,
      page.locator('#export-type'),
      page.getByRole('button', { name: 'Demander l’export' }),
      'exports',
    )
  })

  test('téléphone 360 px : la caisse du jour empile le champ et ses boutons, le champ garde sa largeur', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await signIn(page, 'MANAGER')
    await page.goto('/ventes/caisse-du-jour')

    const day = await box(page.locator('#caisse-jour-date'), 'saisie du jour')
    const show = await box(page.getByRole('button', { name: 'Afficher' }), 'Afficher')
    const today = await box(page.getByRole('button', { name: 'Aujourd’hui' }), 'Aujourd’hui')

    // Empilés : le champ occupe la largeur de l'écran (la date « 28/10/2026 » tient en entier), les
    // boutons sont dessous (aucun décalage d'étiquette qui les laisserait au niveau du libellé).
    expect(day.width, 'largeur de la saisie').toBeGreaterThanOrEqual(250)
    expect(show.y, 'Afficher sous la saisie').toBeGreaterThanOrEqual(day.y + day.height)
    expect(today.y, 'Aujourd’hui sous Afficher').toBeGreaterThanOrEqual(show.y + show.height)
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })

  test('les icônes et le chevron ont leur place : le remplissage de la saisie passe devant px-3', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await signIn(page, 'RECEPTION')
    await page.goto('/patients/nouveau')
    await expect(page.getByLabel('Nom (obligatoire)')).toBeVisible()

    const padding = (locator: Locator, side: 'Left' | 'Right'): Promise<number> =>
      locator.evaluate(
        (element, edge) => Number.parseFloat(getComputedStyle(element)[`padding${edge}`]),
        side,
      )

    // Téléphone : icône à gauche (pl-10 = 40 px) ; liste : chevron à droite (pr-10 = 40 px) ;
    // saisie simple : remplissage d'origine (px-3 = 12 px).
    expect(await padding(page.getByLabel('Téléphone principal'), 'Left')).toBeGreaterThanOrEqual(40)
    expect(await padding(page.getByLabel('Sexe'), 'Right')).toBeGreaterThanOrEqual(40)
    expect(await padding(page.getByLabel('Nom (obligatoire)'), 'Left')).toBe(12)
    expect(await padding(page.getByLabel('Nom (obligatoire)'), 'Right')).toBe(12)
  })
})
