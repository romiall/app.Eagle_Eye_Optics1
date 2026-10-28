import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium, type BrowserContext } from '@playwright/test'

import { chromiumLaunchOptions } from './chromium'
import { MAIN_PORT } from './ports'

/**
 * Profil de navigateur PERSISTANT (G1 ; fichier 25, étape 3) : un répertoire de profil réel, rouvert après la
 * fermeture complète du navigateur. IndexedDB (coffre chiffré), service worker et cookies y survivent comme sur un
 * poste du cabinet ; un simple rechargement ou un contexte en mémoire n'est pas cette preuve. Même origine, langue
 * et fuseau que les autres parcours e2e (playwright.config.ts).
 */
export function newProfileDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'eeo-profil-e2e-'))
}

/** Supprime le profil (données fictives) ; un fichier encore verrouillé par le système n'est pas une erreur du test. */
export function removeProfileDirectory(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch {
    // Windows peut garder un fichier du profil ouvert un instant : le dossier temporaire sera nettoyé par le système.
  }
}

export async function openProfile(directory: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(directory, {
    ...chromiumLaunchOptions(),
    baseURL: `http://127.0.0.1:${MAIN_PORT}`,
    locale: 'fr-FR',
    timezoneId: 'Africa/Douala',
    serviceWorkers: 'allow',
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
  })
}
