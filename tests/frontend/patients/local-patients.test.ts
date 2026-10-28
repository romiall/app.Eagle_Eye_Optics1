import { describe, expect, it } from 'vitest'

import {
  foldLocalPatients,
  isUnconsolidated,
  type LocalPatientEntry,
  localPatientPage,
  matchesLocalSearch,
  patientSummary,
} from '@/domain/patients/local'

/**
 * Fiches patient de CE poste, reconstruites par rejeu des faits du journal local : création, modifications cumulées,
 * état de la dernière commande, recherche locale (casse, accents, ordre des mots, téléphone, numéro de dossier) et
 * pagination. Données fictives.
 */
const ID = '01J9ZXK4M2Q8R7S6T5V4W3PA01'
const OTHER = '01J9ZXK4M2Q8R7S6T5V4W3PA02'

function create(
  entityId: string,
  fields: Record<string, unknown>,
  state = 'local',
  at = '2026-10-28T10:00:00.000Z',
): LocalPatientEntry {
  return {
    state,
    fact: {
      commandName: 'CreatePatient',
      entityId,
      number: 'EE-2026-0042',
      recordedAt: at,
      payload: {
        patient_id: entityId,
        last_name: 'Mbarga',
        first_names: 'Éloïse Marie',
        sex: 'F',
        birth_date: '1985-03-04',
        phone_primary: '+237 600 00 01 02',
        record_number: 'EE-2026-0042',
        ...fields,
      },
    },
  }
}

function update(
  entityId: string,
  changes: Record<string, unknown>,
  state = 'pending',
  at = '2026-10-28T11:00:00.000Z',
): LocalPatientEntry {
  return {
    state,
    fact: {
      commandName: 'UpdatePatient',
      entityId,
      number: null,
      recordedAt: at,
      payload: { patient_id: entityId, changes },
    },
  }
}

describe('rejeu des faits d’une fiche du poste', () => {
  it('une création donne la fiche complète, avec son numéro de dossier de la plage du poste', () => {
    const map = foldLocalPatients([create(ID, {})])
    const entry = map.get(ID)

    expect(entry?.state).toBe('local')
    expect(entry?.patient).toMatchObject({
      id: ID,
      record_number: 'EE-2026-0042',
      last_name: 'Mbarga',
      first_names: 'Éloïse Marie',
      sex: 'F',
      birth_date: '1985-03-04',
      phone_primary: '+237 600 00 01 02',
      archived: false,
      merged_into_patient_id: null,
      version: 1,
      guardian_contact: null,
      legacy_record: false,
      created_at: '2026-10-28T10:00:00.000Z',
    })
  })

  it('le numéro de dossier vient du fait quand la charge ne le porte pas, et un sexe inconnu devient « UNKNOWN »', () => {
    const entry = create(ID, { record_number: undefined, sex: 'X' })
    const map = foldLocalPatients([entry])

    expect(map.get(ID)?.patient.record_number).toBe('EE-2026-0042')
    expect(map.get(ID)?.patient.sex).toBe('UNKNOWN')
  })

  it('les modifications se CUMULENT : la tête du poste ne garde que la dernière, le rejeu les applique toutes', () => {
    const map = foldLocalPatients([
      create(ID, {}),
      update(ID, { phone_primary: '+237 600 00 09 99' }),
      update(
        ID,
        { address: 'Bastos', profession: 'Enseignante' },
        'local',
        '2026-10-28T12:00:00.000Z',
      ),
    ])
    const entry = map.get(ID)

    expect(entry?.patient).toMatchObject({
      phone_primary: '+237 600 00 09 99',
      address: 'Bastos',
      profession: 'Enseignante',
      version: 3,
      updated_at: '2026-10-28T12:00:00.000Z',
    })
    // L'état affiché est celui de la DERNIÈRE commande qui a touché la fiche.
    expect(entry?.state).toBe('local')
  })

  it('un champ vidé vaut null, le nom ne devient jamais vide, une charge illisible est ignorée', () => {
    const map = foldLocalPatients([
      create(ID, { address: 'Bastos' }),
      update(ID, { address: null, last_name: '', first_names: null }),
      {
        ...update(ID, {}),
        fact: { ...update(ID, {}).fact, payload: { patient_id: ID, changes: 'oups' } },
      },
    ])

    expect(map.get(ID)?.patient).toMatchObject({
      address: null,
      last_name: 'Mbarga',
      first_names: null,
      version: 2,
    })
  })

  it('une modification d’une fiche du serveur (sans création locale) n’a pas de base à rejouer', () => {
    const map = foldLocalPatients([update(OTHER, { address: 'Bonanjo' })])

    expect(map.size).toBe(0)
  })

  it('plusieurs fiches restent distinctes, chacune avec son état', () => {
    const map = foldLocalPatients([
      create(ID, {}, 'acknowledged'),
      create(OTHER, { last_name: 'Tchoua', record_number: 'EE-2026-0043' }, 'pending'),
    ])

    expect([...map.keys()]).toEqual([ID, OTHER])
    expect(map.get(OTHER)?.patient.last_name).toBe('Tchoua')
    expect(map.get(ID)?.state).toBe('acknowledged')
  })
})

describe('proposition du poste et serveur', () => {
  it('seules les propositions consolidées ou rejetées cèdent la place au serveur', () => {
    for (const state of ['local', 'pending', 'waiting_dependency', 'conflict']) {
      expect(isUnconsolidated(state), state).toBe(true)
    }
    for (const state of ['acknowledged', 'rejected']) {
      expect(isUnconsolidated(state), state).toBe(false)
    }
  })

  it('le résumé reprend les seuls champs de la liste', () => {
    const patient = foldLocalPatients([create(ID, {})]).get(ID)?.patient
    if (patient === undefined) throw new Error('fiche attendue')

    expect(patientSummary(patient)).toEqual({
      id: ID,
      record_number: 'EE-2026-0042',
      last_name: 'Mbarga',
      first_names: 'Éloïse Marie',
      sex: 'F',
      birth_date: '1985-03-04',
      phone_primary: '+237 600 00 01 02',
      archived: false,
      merged_into_patient_id: null,
      version: 1,
    })
  })
})

describe('recherche locale', () => {
  const patient = foldLocalPatients([create(ID, {})]).get(ID)?.patient
  if (patient === undefined) throw new Error('fiche attendue')

  it('le nom et les prénoms se retrouvent sans tenir compte de la casse, des accents ni de l’ordre des mots', () => {
    for (const query of ['mbarga', 'MBARGA', 'eloise', 'Éloïse Marie', 'marie mbarga', 'mba']) {
      expect(matchesLocalSearch(patient, query), query).toBe(true)
    }
    expect(matchesLocalSearch(patient, 'tchoua')).toBe(false)
    expect(matchesLocalSearch(patient, 'mbarga paul')).toBe(false)
  })

  it('le téléphone se retrouve par ses chiffres, quelle que soit la mise en forme', () => {
    expect(matchesLocalSearch(patient, '600 00 01 02')).toBe(true)
    expect(matchesLocalSearch(patient, '237600000102')).toBe(true)
    expect(matchesLocalSearch(patient, '600 00 09 99')).toBe(false)
  })

  it('le numéro de dossier se retrouve, une saisie trop courte ne trouve rien', () => {
    expect(matchesLocalSearch(patient, 'EE-2026-0042')).toBe(true)
    expect(matchesLocalSearch(patient, 'ee-2026')).toBe(true)
    expect(matchesLocalSearch(patient, 'm')).toBe(false)
    expect(matchesLocalSearch(patient, '   ')).toBe(false)
  })
})

describe('page de résultats locaux', () => {
  function many(count: number) {
    const entries = Array.from({ length: count }, (_, index) =>
      create(`01J9ZXK4M2Q8R7S6T5V4W3P${String(index).padStart(3, '0')}`, {
        last_name: `Nom${String(count - index).padStart(2, '0')}`,
        first_names: null,
        record_number: `EE-2026-${String(index).padStart(4, '0')}`,
      }),
    )
    return [...foldLocalPatients(entries).values()].map((entry) => entry.patient)
  }

  it('25 par page, triées par nom, avec les totaux de ce poste', () => {
    const patients = many(30)

    const first = localPatientPage(patients, 1)
    expect(first.data).toHaveLength(25)
    expect(first.data[0]?.last_name).toBe('Nom01')
    expect(first.meta).toEqual({ current_page: 1, last_page: 2, per_page: 25, total: 30 })

    const second = localPatientPage(patients, 2)
    expect(second.data).toHaveLength(5)
    expect(second.data.at(-1)?.last_name).toBe('Nom30')
  })

  it('aucune fiche : une page vide, jamais un total négatif ni zéro page', () => {
    expect(localPatientPage([], 1)).toEqual({
      data: [],
      meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 },
    })
  })
})
