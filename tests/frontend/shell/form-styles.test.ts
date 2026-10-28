import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contrat de présentation des formulaires (base.css) : ce que les composants partagés supposent de
 * la feuille de style. La mise en page elle-même (alignement des saisies d'une rangée, bouton aligné
 * sur la saisie) est vérifiée dans un vrai navigateur par tests/e2e/patients.spec.ts.
 */
const BASE_CSS = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'resources', 'frontend', 'styles', 'base.css'),
  'utf8',
)

/** Corps de la première règle dont le sélecteur est exactement `selector` (hors commentaires). */
function ruleBody(selector: string): string {
  const css = BASE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = css.search(
    new RegExp(`(^|[\\s}{])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`),
  )
  if (start < 0) throw new Error(`Règle ${selector} absente de base.css`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

/** Profondeur d'accolades (blocs `@layer`, `@media`) à la position donnée, commentaires exclus. */
function depthAt(selector: string): number {
  const css = BASE_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const index = css.indexOf(selector)
  if (index < 0) throw new Error(`Règle ${selector} absente de base.css`)
  let depth = 0
  for (const character of css.slice(0, index)) {
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
  }
  return depth
}

describe('base.css : formulaires', () => {
  it('aligne les champs d’une grille en haut : l’aide et l’erreur sont sous la saisie', () => {
    expect(ruleBody('.form-grid')).toMatch(/align-items:\s*start/)
  })

  it('règle le décalage des boutons posés à côté d’un champ sur l’étiquette', () => {
    const root = ruleBody(':root')
    expect(root).toMatch(/--field-label-height:\s*1\.25rem/)
    expect(root).toMatch(/--field-label-gap:\s*0\.375rem/)
    expect(root).toMatch(
      /--field-label-offset:\s*calc\(var\(--field-label-height\)\s*\+\s*var\(--field-label-gap\)\)/,
    )
    // L'étiquette de FieldShell prend ses mesures aux mêmes variables.
    const label = ruleBody('.field-label')
    expect(label).toMatch(/line-height:\s*var\(--field-label-height\)/)
    expect(label).toMatch(/margin-bottom:\s*var\(--field-label-gap\)/)
    // Barre d'outils et `.field-action` : le bouton descend de ce décalage dès 640 px.
    expect(BASE_CSS).toMatch(
      /\.toolbar > :is\(button, a\)\s*\{\s*margin-top: var\(--field-label-offset\)/,
    )
    expect(BASE_CSS).toMatch(/\.field-action\s*\{\s*margin-top: var\(--field-label-offset\)/)
  })

  it('garde le contour de focus des champs hors couche : sinon le contour commun le recouvre', () => {
    // Une règle hors couche l'emporte sur toute règle de couche ; le focus commun est hors couche,
    // celui des champs doit l'être aussi (et plus spécifique) pour le remplacer.
    expect(depthAt(':focus-visible {')).toBe(0)
    expect(depthAt('.field-control:focus-visible {')).toBe(0)
    const focus = ruleBody('.field-control:focus-visible')
    expect(focus).toMatch(/outline:\s*2px solid var\(--color-primary\)/)
    expect(ruleBody(".field-control[aria-invalid='true']:focus-visible")).toMatch(
      /outline-color:\s*var\(--color-danger\)/,
    )
  })

  it('ne retire jamais le contour de focus d’un champ (contraste forcé compris)', () => {
    const focus = ruleBody('.field-control:focus-visible')
    expect(focus).not.toMatch(/outline:\s*(none|0)/)
    expect(focus).not.toMatch(/outline-width:\s*0/)
  })

  it('n’emploie aucune ressource distante ni image : tracés en ligne seulement', () => {
    expect(BASE_CSS).not.toMatch(/url\(|@font-face|@import/i)
  })
})
