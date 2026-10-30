/**
 * Boutons « Modifier » et « Supprimer » d'un examen (liste des examens et éditeur) : règles d'AFFICHAGE, jamais
 * d'autorité. Le serveur applique les mêmes règles à chaque commande et répond 409 (état) ou 403 (qui) : un bouton
 * montré à tort n'ouvre aucun droit, un bouton caché à tort ne retire rien.
 *
 * - « Supprimer » : un examen resté BROUILLON seulement (aucune rubrique enregistrée), pour le professionnel qui l'a
 *   démarré ou pour la gérante (`approval.decide`, la même notion que « modifier le brouillon d'un autre compte » en
 *   facturation), avec l'écriture clinique (`clinical.write`) et la lecture (`clinical.read`). Un examen en cours ou
 *   terminé ne se supprime pas : il se poursuit ou, une fois terminé, se corrige par une révision motivée.
 * - « Modifier » : poursuivre un brouillon ou un examen en cours (`clinical.write`) ; pour un examen terminé, ouvrir la
 *   correction, qui enregistre une NOUVELLE révision (`clinical.amend`), jamais un écrasement.
 */

/** Permission qui désigne la gérante : elle peut supprimer le brouillon d'un autre professionnel. */
export const MANAGER_PERMISSION = 'approval.decide'

/** Ce que l'écran sait du compte qui regarde : son identifiant et ses droits tels que l'écran les affiche. */
export interface Viewer {
  accountId: string | null
  can: (permission: string) => boolean
}

export interface ExamLike {
  status: string
  /** Professionnel qui a démarré l'examen. */
  clinicianId: string
}

/** Un examen reste « brouillon » tant qu'aucune rubrique n'y est enregistrée. */
export function isDraftExam(status: string): boolean {
  return status === 'DRAFT'
}

export function canDeleteDraftExam(exam: ExamLike, viewer: Viewer): boolean {
  if (!isDraftExam(exam.status)) return false
  if (!viewer.can('clinical.write') || !viewer.can('clinical.read')) return false
  return (
    (viewer.accountId !== null && exam.clinicianId === viewer.accountId) ||
    viewer.can(MANAGER_PERMISSION)
  )
}

/** `continue` : poursuivre le brouillon ou l'examen en cours ; `correct` : corriger un examen terminé ; sinon rien. */
export type ModifyKind = 'continue' | 'correct'

export function modifyKind(exam: ExamLike, viewer: Viewer): ModifyKind | null {
  if (exam.status === 'COMPLETED') {
    return viewer.can('clinical.amend') && viewer.can('clinical.read') ? 'correct' : null
  }
  if (exam.status === 'DRAFT' || exam.status === 'IN_PROGRESS') {
    return viewer.can('clinical.write') && viewer.can('clinical.read') ? 'continue' : null
  }
  return null
}

/**
 * Précision ajoutée au nom accessible de « Modifier » (lue par les lecteurs d'écran, jamais une infobulle : elle
 * n'existe pas au toucher) : un examen terminé ne s'écrase pas, sa correction enregistre une nouvelle révision.
 */
export function modifyNote(kind: ModifyKind): string {
  return kind === 'correct' ? ' (correction : nouvelle révision motivée, rien n’est écrasé)' : ''
}
