import { describe, expect, it } from 'vitest'

import {
  canDeleteDraftExam,
  isDraftExam,
  MANAGER_PERMISSION,
  modifyKind,
  modifyNote,
  type Viewer,
} from '@/domain/clinical/draftDeletion'

/**
 * Boutons « Modifier » et « Supprimer » d'un examen : règles d'affichage selon l'état de l'examen, l'auteur et les droits
 * du compte. Le serveur applique les mêmes règles à chaque commande (409 état, 403 auteur) ; ces tests ne prouvent que
 * ce que l'écran montre. Données fictives.
 */
const AUTHOR = '01J9ZXK4M2Q8R7S6T5V4W30002'
const OTHER = '01J9ZXK4M2Q8R7S6T5V4W30S01'

function viewer(accountId: string | null, ...permissions: string[]): Viewer {
  return { accountId, can: (permission) => permissions.includes(permission) }
}

const exam = (status: string, clinicianId = AUTHOR) => ({ status, clinicianId })

describe('suppression d’un brouillon d’examen', () => {
  it('seul l’état « brouillon » est supprimable', () => {
    const author = viewer(AUTHOR, 'clinical.read', 'clinical.write')

    expect(isDraftExam('DRAFT')).toBe(true)
    expect(canDeleteDraftExam(exam('DRAFT'), author)).toBe(true)
    expect(canDeleteDraftExam(exam('IN_PROGRESS'), author)).toBe(false)
    expect(canDeleteDraftExam(exam('COMPLETED'), author)).toBe(false)
    expect(canDeleteDraftExam(exam('ABANDONNE_INCONNU'), author)).toBe(false)
  })

  it('même la gérante ne supprime ni un examen en cours ni un examen terminé', () => {
    const manager = viewer(OTHER, 'clinical.read', 'clinical.write', MANAGER_PERMISSION)

    expect(canDeleteDraftExam(exam('IN_PROGRESS'), manager)).toBe(false)
    expect(canDeleteDraftExam(exam('COMPLETED'), manager)).toBe(false)
  })

  it('l’auteur du brouillon le supprime, un autre professionnel non', () => {
    expect(
      canDeleteDraftExam(exam('DRAFT'), viewer(AUTHOR, 'clinical.read', 'clinical.write')),
    ).toBe(true)
    expect(
      canDeleteDraftExam(exam('DRAFT'), viewer(OTHER, 'clinical.read', 'clinical.write')),
    ).toBe(false)
  })

  it('la gérante supprime le brouillon d’un autre professionnel', () => {
    const manager = viewer(OTHER, 'clinical.read', 'clinical.write', MANAGER_PERMISSION)

    expect(canDeleteDraftExam(exam('DRAFT'), manager)).toBe(true)
  })

  it('sans l’écriture ou la lecture cliniques, aucun bouton, même pour l’auteur ou la gérante', () => {
    expect(canDeleteDraftExam(exam('DRAFT'), viewer(AUTHOR, 'clinical.read'))).toBe(false)
    expect(canDeleteDraftExam(exam('DRAFT'), viewer(AUTHOR, 'clinical.write'))).toBe(false)
    expect(
      canDeleteDraftExam(exam('DRAFT'), viewer(OTHER, 'clinical.read', MANAGER_PERMISSION)),
    ).toBe(false)
    expect(canDeleteDraftExam(exam('DRAFT'), viewer(AUTHOR))).toBe(false)
  })

  it('un compte inconnu n’est jamais l’auteur', () => {
    expect(canDeleteDraftExam(exam('DRAFT'), viewer(null, 'clinical.read', 'clinical.write'))).toBe(
      false,
    )
  })
})

describe('modifier un examen', () => {
  it('un brouillon et un examen en cours se poursuivent avec l’écriture clinique', () => {
    const writer = viewer(AUTHOR, 'clinical.read', 'clinical.write')

    expect(modifyKind(exam('DRAFT'), writer)).toBe('continue')
    expect(modifyKind(exam('IN_PROGRESS'), writer)).toBe('continue')
    expect(modifyKind(exam('DRAFT'), viewer(AUTHOR, 'clinical.read'))).toBeNull()
  })

  it('un examen terminé ne se modifie que par la correction (clinical.amend), jamais par l’écriture simple', () => {
    expect(
      modifyKind(exam('COMPLETED'), viewer(AUTHOR, 'clinical.read', 'clinical.write')),
    ).toBeNull()
    expect(modifyKind(exam('COMPLETED'), viewer(AUTHOR, 'clinical.read', 'clinical.amend'))).toBe(
      'correct',
    )
    expect(modifyKind(exam('COMPLETED'), viewer(AUTHOR, 'clinical.amend'))).toBeNull()
  })

  it('un état inconnu n’offre rien', () => {
    expect(
      modifyKind(exam('ETAT_INCONNU'), viewer(AUTHOR, 'clinical.read', 'clinical.write')),
    ).toBeNull()
  })

  it('dit ce que fait « Modifier » : une correction écrit une nouvelle révision', () => {
    expect(modifyNote('correct')).toContain('nouvelle révision')
    expect(modifyNote('continue')).toBe('')
  })
})
