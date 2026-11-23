import { auth } from '../firebase';

export async function getFirebaseIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export async function getAuthHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const token = await getFirebaseIdToken();
  if (!token) return { ...extra };
  return {
    ...extra,
    Authorization: `Bearer ${token}`,
  };
}
