import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { demoAccount } from './support/accounts'
import { activeServiceWorkerScope, foreignRequests, recordRequests } from './support/browser'
import {
  api,
  deviceIdByCode,
  navigateInApp,
  numberRange,
  numberValue,
  prepareThisDevice,
  signIn,
} from './support/device'
import { startLaravelServer } from './support/laravel-server'
import { START_OFFLINE_PORT } from './support/ports'
import { newProfileDirectory, openProfile, removeProfileDirectory } from './support/profile'

/**
 * AT36 à la lettre (fichier 14) : DÉMARRAGE sans réseau d'un poste préparé, sur un vrai profil de navigateur persistant
 * et un serveur RÉELLEMENT arrêté (vault.md D14, D27 ; Playwright n'applique pas « hors ligne » aux requêtes du service
 * worker, voir smoke.spec.ts) :
 *
 *  1. serveur en marche : la gérante prépare ce poste (coffre, enrôlement, autorisation, numéros) et verrouille le poste ;
 *  2. le navigateur est fermé ENTIÈREMENT, le serveur ARRÊTÉ, puis le navigateur rouvert : la coquille vient du service
 *     worker, l'écran public de déverrouillage passe avant la connexion, le profil se déverrouille, le profil du coffre
 *     devient l'identité d'action ; un écran qui lit le serveur reste fermé, un patient est créé sur le poste (numéro de
 *     sa plage) ;
 *  3. verrouiller le poste démonte la coquille ; une nouvelle fermeture complète, serveur toujours arrêté, retrouve la
 *     pièce dans le coffre ;
 *  4. le serveur revient : la personne se connecte depuis l'en-tête, le poste envoie sa pièce, et le serveur la connaît
 *     avec un numéro de la plage du poste.
 *
 * Données FICTIVES. Le module « offline » est ouvert par prepare-env.mjs.
 */

const VAULT_SECRET = 'cascade-ambre-voile-tigre-39'
const ORIGIN = `http://127.0.0.1:${START_OFFLINE_PORT}`
/** Origine dédiée déclarée comme origine de la SPA pour ce serveur (comme auth-session.spec.ts). */
const SERVER_ENVIRONMENT = {
  SANCTUM_STATEFUL_DOMAINS: `127.0.0.1:${START_OFFLINE_PORT}`,
  APP_URL: ORIGIN,
}

/** Captures d'écran facultatives pour une revue visuelle : `EEO_E2E_CAPTURES` = répertoire de sortie (absent en CI). */
async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env['EEO_E2E_CAPTURES']
  if (directory === undefined || directory === '') return
  await page.screenshot({ path: join(directory, `${name}.png`) })
}

function syncSection(page: Page) {
  return page.locator('section[aria-labelledby="titre-synchronisation"]')
}

/** Déverrouille depuis l'écran PUBLIC (un seul profil sur ce poste : présélectionné). */
async function unlockFromPublicScreen(page: Page, secret: string): Promise<void> {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Déverrouiller ce poste' }),
  ).toBeVisible()
  await page.getByLabel('Secret local').fill(secret)
  await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click()
}

test.describe('démarrage sans réseau : déverrouillage public du poste (AT36, D14, D27)', () => {
  test('fermeture complète, serveur arrêté, déverrouillage, patient local, retour du serveur', async () => {
    test.setTimeout(600_000)
    const run = Date.now().toString(36)
    const stamp = String(Date.now()).slice(-4)
    const phone = `+237 600 00 ${stamp.slice(0, 2)} ${stamp.slice(2)}`
    const manager = demoAccount('MANAGER')
    const profile = newProfileDirectory()
    let server = await startLaravelServer(START_OFFLINE_PORT, SERVER_ENVIRONMENT)
    let context = await openProfile(profile, server.url)

    try {
      // --- 1. Serveur en marche : poste préparé, puis verrouillé depuis l'en-tête --------------------------------
      let page = await context.newPage()
      await signIn(page, 'MANAGER')
      const deviceCode = `AT36-${run}`.toUpperCase()
      await prepareThisDevice(page, {
        secret: VAULT_SECRET,
        code: deviceCode,
        name: 'Poste démarrage hors réseau (e2e)',
      })
      const deviceId = await deviceIdByCode(page, deviceCode)
      // Le poste se verrouille depuis l'en-tête sans quitter la session du serveur (coffre ouvert : le bouton est offert).
      const lock = page.getByRole('button', { name: 'Verrouiller le poste' })
      await lock.click()
      await expect(lock).toBeHidden()
      // Le service worker a précaché la coquille : le prochain démarrage n'a pas besoin du réseau. Il contrôle les
      // pages à partir de la navigation suivante (clientsClaim désactivé) : un rechargement le fait passer en contrôle.
      expect(await activeServiceWorkerScope(page)).toMatch(/\/$/)
      await page.reload()
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
        .toBe(true)
      // Coffre verrouillé mais session du serveur ouverte : aucun écran de déverrouillage n'est imposé.
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()

      // --- 2. Fermeture COMPLÈTE, serveur ARRÊTÉ, réouverture ----------------------------------------------------
      await context.close()
      await server.stop()
      context = await openProfile(profile, ORIGIN)
      const requests = recordRequests(context)
      page = await context.newPage()
      await page.goto('/')
      // Un coffre existe et aucune identité n'est connue : le déverrouillage passe AVANT la connexion.
      await expect(page).toHaveURL(/\/deverrouiller(\?.*)?$/)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Déverrouiller ce poste' }),
      ).toBeVisible()
      await expect(page.getByLabel('Profil')).toContainText(`(${manager.login})`)
      // La coquille métier n'est pas là : ni menu, ni compte, ni déconnexion.
      await expect(page.getByRole('navigation')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0)

      // Un mauvais secret est refusé sans rien révéler, puis le bon ouvre le profil.
      await page.getByLabel('Secret local').fill('mauvais-secret-fictif-00')
      await page.getByRole('button', { name: 'Déverrouiller', exact: true }).click()
      await expect(page.getByText('Profil ou secret incorrect.').first()).toBeVisible()
      await capture(page, '1-deverrouillage-refuse')
      await expect(page.getByLabel('Secret local')).toHaveValue('')
      await unlockFromPublicScreen(page, VAULT_SECRET)

      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      await expect(page.getByText('Profil local : serveur non joint')).toBeVisible()
      await capture(page, '2-accueil-profil-local')
      await expect(page).toHaveURL(/\/$/)

      // Un écran qui lit le serveur reste fermé, l'accueil l'explique.
      await page.evaluate(() => {
        window.history.pushState({}, '', '/patients')
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
      await expect(page.getByText(/« Patients » demande le serveur/)).toBeVisible()
      await expect(page).toHaveURL(/\/$/)

      // Un patient est créé sur le poste, sans le serveur (numéro de dossier de la plage du poste).
      await navigateInApp(page, '/patients/nouveau')
      const patientName = `PATIENT DEMARRAGE ${run}`.toUpperCase()
      await page.getByLabel('Nom (obligatoire)').fill(patientName)
      await page.getByLabel('Prénom(s)').fill('Test')
      await page.getByLabel('Sexe').selectOption({ label: 'Féminin' })
      await page.getByLabel('Date de naissance', { exact: true }).fill('04/03/1985')
      await page.getByLabel('Téléphone principal').fill(phone)
      await page.getByRole('button', { name: 'Enregistrer le patient' }).click()
      const noCheck = page.getByRole('dialog', { name: 'Vérification des doublons impossible' })
      await expect(noCheck).toContainText(/le serveur n’est pas joignable/)
      await noCheck.getByRole('button', { name: 'Créer sans vérification' }).click()
      await expect(page.getByText(/Enregistré sur ce poste/).first()).toBeVisible()
      await expect(page.getByText(/pièces? en attente de synchronisation/).first()).toBeVisible()

      // --- 3. Verrouiller démonte la coquille ; une nouvelle fermeture complète retrouve la pièce ------------------
      await page.getByRole('button', { name: 'Verrouiller le poste' }).click()
      await expect(page).toHaveURL(/\/deverrouiller(\?.*)?$/)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Déverrouiller ce poste' }),
      ).toBeVisible()
      await expect(page.getByText(/Enregistré sur ce poste/)).toHaveCount(0)
      await expect(page.getByRole('navigation')).toHaveCount(0)

      await context.close()
      context = await openProfile(profile, ORIGIN)
      page = await context.newPage()
      await page.goto('/')
      await expect(page).toHaveURL(/\/deverrouiller(\?.*)?$/)
      await unlockFromPublicScreen(page, VAULT_SECRET)
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      await navigateInApp(page, '/parametres/poste')
      // La pièce est retrouvée dans le coffre : à envoyer, ou envoyée sans confirmation (le poste a tenté un échange
      // pendant que le serveur était arrêté) ; jamais consolidée, jamais en conflit.
      await expect(syncSection(page)).toContainText(/pas encore envoyées : \d+/)
      await expect
        .poll(async () => {
          const text = await syncSection(page).innerText()
          const count = (pattern: RegExp): number => Number(pattern.exec(text)?.[1] ?? Number.NaN)
          return count(/pas encore envoyées : (\d+)/) + count(/en attente de confirmation : (\d+)/)
        })
        .toBe(1)
      await expect(syncSection(page)).toContainText(/Conflits à revoir : 0/)
      const foreign = foreignRequests(requests, ORIGIN)
      expect(foreign, 'aucune requête hors de l’origine, démarrage compris').toEqual([])

      // --- 4. Le serveur revient : connexion depuis l'en-tête, envoi, preuve côté serveur ---------------------------
      server = await startLaravelServer(START_OFFLINE_PORT, SERVER_ENVIRONMENT)
      // La tête du journal du poste est lue dans le lot envoyé : elle sert à rendre les ressources en fin de parcours.
      const journal: { head: { sequence: string; hash: string } | null } = { head: null }
      page.on('request', (request) => {
        if (!request.url().endsWith('/api/v1/sync/push')) return
        const body = request.postDataJSON() as {
          commands?: { core: { device_sequence: string | number }; event_hash: string }[]
        } | null
        for (const command of body?.commands ?? []) {
          const sequence = String(command.core.device_sequence)
          if (journal.head === null || Number(sequence) > Number(journal.head.sequence)) {
            journal.head = { sequence, hash: command.event_hash }
          }
        }
      })
      await page.getByRole('link', { name: 'Se connecter au serveur' }).click()
      await page.getByLabel('Identifiant').fill(manager.login)
      await page.getByLabel('Mot de passe').fill(manager.password)
      await page.getByRole('button', { name: 'Se connecter' }).click()
      await expect(page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible()
      // Le serveur prend la place du profil local : plus de mention « profil local ».
      await expect(page.getByText('Profil local : serveur non joint')).toHaveCount(0)
      await page.getByRole('button', { name: 'Synchroniser', exact: true }).click()
      await expect(page.getByText(/Synchronisé le /).first()).toBeVisible()

      const { request, headers } = await api(page)
      const found = (await (
        await request.get(`/api/v1/patients?query=${encodeURIComponent(patientName)}`, { headers })
      ).json()) as { data: { record_number: string }[] }
      expect(found.data).toHaveLength(1)
      const record = found.data[0]?.record_number ?? ''
      expect(record).toMatch(/^EE-\d{4}-\d{4,}$/)
      const records = await numberRange(page, deviceId, 'PATIENT')
      expect(numberValue(record)).toBeGreaterThanOrEqual(records.start)
      expect(numberValue(record)).toBeLessThanOrEqual(records.end)

      // Les ressources de ce poste sont rendues : une seule caisse hors ligne principale détient les numéros financiers.
      expect(journal.head, 'tête du journal lue dans le lot envoyé').not.toBeNull()
      // Opération sensible : le mot de passe de la gérante est confirmé dans cette session (connexion toute récente).
      const reauthenticated = await request.post('/api/v1/auth/reauthenticate', {
        headers,
        data: { password: manager.password },
      })
      expect(reauthenticated.status(), await reauthenticated.text()).toBe(200)
      const released = await request.post(`/api/v1/devices/${deviceId}/release`, {
        headers: { ...headers, 'Idempotency-Key': `e2e-at36-release-${run}` },
        data: {
          expected_version: null,
          last_device_sequence: journal.head?.sequence,
          last_event_hash: journal.head?.hash,
          reason: 'Fin du parcours de démarrage hors réseau (e2e)',
        },
      })
      expect(released.status(), await released.text()).toBe(200)
    } finally {
      await context.close().catch(() => undefined)
      await server.stop().catch(() => undefined)
      removeProfileDirectory(profile)
    }
  })
})
