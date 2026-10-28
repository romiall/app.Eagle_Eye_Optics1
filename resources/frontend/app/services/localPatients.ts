import {
  foldLocalPatients,
  type LocalPatient,
  type LocalPatientEntry,
} from '@/domain/patients/local'

import { localAdministrativeFacts } from './vault'

/**
 * Fiches patient de CE poste (créées ou modifiées hors ligne, consolidées ou non), reconstruites par rejeu des faits du
 * journal local (`domain/patients/local`). Vide tant que le coffre est fermé, que le module hors-ligne l'est, ou que le
 * profil n'a pas le compartiment administratif : rien n'est alors lu ni supposé. Lecture seule, jamais d'écriture ici.
 */
export async function localPatients(): Promise<Map<string, LocalPatient>> {
  const records = await localAdministrativeFacts()
  const entries: LocalPatientEntry[] = records
    .filter((record) => record.fact.entityType === 'patient_records')
    .map((record) => ({ fact: record.fact, state: record.state }))
  return foldLocalPatients(entries)
}
