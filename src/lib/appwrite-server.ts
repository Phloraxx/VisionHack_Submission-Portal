// Server-side Appwrite client with API key for admin operations
import { Client, Databases, Storage, Users, Messaging } from 'node-appwrite';

// Create server client with API key
const serverClient = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!); // API key for server operations

export const serverDatabases = new Databases(serverClient);
export const serverStorage = new Storage(serverClient);
export const serverUsers = new Users(serverClient);
export const serverMessaging = new Messaging(serverClient);

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

export { serverClient };
