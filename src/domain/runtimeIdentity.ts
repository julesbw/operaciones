import type { OperatorSession, UserProfile } from './models'

export function getEffectiveDisplayName(
  technicalUser: UserProfile,
  operatorSession: OperatorSession | null,
): string {
  return operatorSession?.account.displayName ?? technicalUser.fullName
}
