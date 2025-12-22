import { Client, Account, Databases, Storage, ID, Models } from 'appwrite';

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);

export const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
export const COLLECTIONS = {
  INSTITUTIONS: process.env.NEXT_PUBLIC_APPWRITE_INSTITUTIONS_COLLECTION_ID!,
  TEAMS: process.env.NEXT_PUBLIC_APPWRITE_TEAMS_COLLECTION_ID!,
  MEMBERS: process.env.NEXT_PUBLIC_APPWRITE_MEMBERS_COLLECTION_ID!,
  CONFIG: process.env.NEXT_PUBLIC_APPWRITE_CONFIG_COLLECTION_ID!,
  THEMES: process.env.NEXT_PUBLIC_APPWRITE_THEMES_COLLECTION_ID!,
  GALLERY: process.env.NEXT_PUBLIC_APPWRITE_GALLERY_COLLECTION_ID!,
};

export const BUCKETS = {
  SUBMISSIONS: process.env.NEXT_PUBLIC_APPWRITE_SUBMISSIONS_BUCKET_ID!,
  ASSETS: process.env.NEXT_PUBLIC_APPWRITE_ASSETS_BUCKET_ID!,
};

// User roles
export enum UserRole {
  ADMIN = 'admin',
  INSTITUTION = 'institution',
  TEAM_LEAD = 'lead',
  COORDINATOR = 'coordinator',
}

// Auth helpers
export const authHelpers = {
  login: async (email: string, password: string) => {
    return await account.createEmailPasswordSession(email, password);
  },

  logout: async () => {
    return await account.deleteSession('current');
  },

  getCurrentUser: async () => {
    try {
      return await account.get();
    } catch (error) {
      return null;
    }
  },

  getUserRole: (user: Models.User<Models.Preferences>): UserRole | null => {
    // Role is stored in user labels
    const labels = user.labels || [];
    if (labels.includes('admin')) return UserRole.ADMIN;
    if (labels.includes('coordinator')) return UserRole.COORDINATOR;
    if (labels.includes('institution')) return UserRole.INSTITUTION;
    if (labels.includes('lead')) return UserRole.TEAM_LEAD;
    return null; // No valid role found
  },

  getRoleDashboard: (role: UserRole): string => {
    switch (role) {
      case UserRole.ADMIN:
        return '/admin/dashboard';
      case UserRole.INSTITUTION:
        return '/institution/dashboard';
      case UserRole.COORDINATOR:
        return '/coordinator/dashboard';
      case UserRole.TEAM_LEAD:
        return '/team/dashboard';
      default:
        return '/auth/login';
    }
  },
};

export { client, ID };
