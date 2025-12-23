// Auth service for creating accounts and managing invitations
import { Client, Account, Users, ID } from 'node-appwrite';

// Server-side Appwrite client (with API key)
function getServerClient() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_API_KEY!); // Server-side API key
  
  return client;
}

// Generate a random secure password
export function generatePassword(length: number = 12): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  
  // Ensure at least one of each type
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
  password += '0123456789'[Math.floor(Math.random() * 10)];
  password += '!@#$%^&*'[Math.floor(Math.random() * 8)];
  
  // Fill the rest
  for (let i = password.length; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

export interface CreateUserParams {
  email: string;
  name: string;
  role: 'institution' | 'lead';
  institutionId?: string;
}

export interface CreateUserResult {
  userId: string;
  email: string;
  password: string;
  name: string;
  success: boolean;
  error?: string;
}

// Create a user account with Appwrite
export async function createUserAccount(params: CreateUserParams): Promise<CreateUserResult> {
  const { email, name, role, institutionId } = params;
  const password = generatePassword();
  
  try {
    const client = getServerClient();
    const users = new Users(client);
    
    // Create the user
    const user = await users.create(
      ID.unique(),
      email,
      undefined, // phone (optional)
      password,
      name
    );
    
    // Add role label
    await users.updateLabels(user.$id, [role]);
    
    // Store additional metadata in preferences if needed
    if (institutionId) {
      await users.updatePrefs(user.$id, {
        institutionId,
        role
      });
    }
    
    return {
      userId: user.$id,
      email: user.email,
      password,
      name: user.name,
      success: true
    };
  } catch (error: any) {
    console.error('Error creating user:', error);
    return {
      userId: '',
      email,
      password: '',
      name,
      success: false,
      error: error.message || 'Failed to create user'
    };
  }
}

// Bulk create campus lead accounts
export async function bulkCreateCampusLeads(
  leads: Array<{ collegeName: string; campusLeadName: string; email: string }>
): Promise<CreateUserResult[]> {
  const results: CreateUserResult[] = [];
  
  for (const lead of leads) {
    const result = await createUserAccount({
      email: lead.email,
      name: lead.campusLeadName,
      role: 'institution',
      institutionId: lead.collegeName.toLowerCase().replace(/\s+/g, '-')
    });
    
    results.push(result);
    
    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return results;
}

// Create team lead accounts
export async function createTeamLeads(
  leads: Array<{ name: string; email: string }>,
  institutionId: string
): Promise<CreateUserResult[]> {
  const results: CreateUserResult[] = [];
  
  for (const lead of leads) {
    const result = await createUserAccount({
      email: lead.email,
      name: lead.name,
      role: 'lead',
      institutionId
    });
    
    results.push(result);
    
    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return results;
}
