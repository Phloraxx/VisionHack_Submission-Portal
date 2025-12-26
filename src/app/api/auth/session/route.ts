import { NextRequest, NextResponse } from 'next/server';
import { Client, Account } from 'node-appwrite';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get('session');

    if (!session) {
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401 }
      );
    }

    // Create Appwrite client with session
    const client = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
      .setSession(session.value);

    const account = new Account(client);

    // Get current user
    const user = await account.get();

    return NextResponse.json({
      user: {
        id: user.$id,
        email: user.email,
        name: user.name,
        labels: user.labels,
        prefs: user.prefs
      }
    });
  } catch (error: any) {
    console.error('Session error:', error);
    return NextResponse.json(
      { error: 'Invalid or expired session' },
      { status: 401 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get('session');

    if (session) {
      // Create Appwrite client with session
      const client = new Client()
        .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
        .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
        .setSession(session.value);

      const account = new Account(client);

      // Delete session
      await account.deleteSession('current');
    }

    // Clear cookie
    const response = NextResponse.json({ success: true });
    response.cookies.delete('session');

    return response;
  } catch (error: any) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Failed to logout' },
      { status: 500 }
    );
  }
}
