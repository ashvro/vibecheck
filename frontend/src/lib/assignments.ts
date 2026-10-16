/**
 * Surfaces what needs action first: unsubmitted before submitted, then the
 * most urgent by due date. Assignments with no due date sink below dated ones
 * but stay ordered newest-first so a freshly posted brief is never buried.
 */
export function sortAssignments<
  T extends { submitted?: boolean; daysLeft?: number | null; createdAt?: string },
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const aDone = a.submitted ? 1 : 0
    const bDone = b.submitted ? 1 : 0
    if (aDone !== bDone) return aDone - bDone
    const av = a.daysLeft
    const bv = b.daysLeft
    if (av !== bv) {
      if (av == null) return 1
      if (bv == null) return -1
      return av - bv
    }
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  })
}
