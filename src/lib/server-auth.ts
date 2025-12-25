// Server-side authentication helper
import { cookies } from 'next/headers';
import { Client, Account } from 'node-appwrite';

export async function getServerSession() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session');
    
    if (!sessionCookie) {
      return null;
    }

    const client = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
      .setSession(sessionCookie.value);

    const account = new Account(client);
    const user = await account.get();

    return {
      userId: user.$id,
      email: user.email,
      name: user.name,
      labels: user.labels
    };
  } catch (error) {
    console.error('Failed to get server session:', error);
    return null;
  }
}
