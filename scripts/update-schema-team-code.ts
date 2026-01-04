
import { Client, Databases } from 'node-appwrite';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env.local
function loadEnvFile() {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const [key, ...valueParts] = trimmedLine.split('=');
                if (key && valueParts.length > 0) {
                    const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
                    process.env[key.trim()] = value;
                }
            }
        });
    }
}

loadEnvFile();

const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
const API_KEY = process.env.APPWRITE_API_KEY!;
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
const TEAMS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_TEAMS_COLLECTION_ID!;

if (!ENDPOINT || !PROJECT_ID || !API_KEY || !DATABASE_ID || !TEAMS_COLLECTION_ID) {
    console.error('Missing environment variables');
    process.exit(1);
}

const client = new Client()
    .setEndpoint(ENDPOINT)
    .setProject(PROJECT_ID)
    .setKey(API_KEY);

const databases = new Databases(client);

async function addTeamCodeAttribute() {
    console.log('Adding team_code attribute to Teams collection...');
    try {
        // Check if attribute exists
        try {
            await databases.getAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'team_code');
            console.log('Attribute team_code already exists.');
        } catch (e) {
            // Attribute doesn't exist, create it
            await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'team_code', 10, false);
            console.log('Created team_code attribute.');

            // Wait for attribute to be available
            console.log('Waiting for attribute to be available...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Pass false for unique to avoid errors on existing documents if any, 
        // but we want it unique. However, Appwrite requires filling existing docs if required.
        // We set required=false for now.

        // Create index
        // Check if index exists
        try {
            await databases.getIndex(DATABASE_ID, TEAMS_COLLECTION_ID, 'team_code_idx');
            console.log('Index team_code_idx already exists.');
        } catch (e) {
            // Create unique index
            /* 
            NOTE: Creating a unique index on a field that might be null for existing documents 
            might fail if there are multiple existing documents (all null).
            For now, let's create a regular key index, or handle backfilling if needed.
            Since this is dev/setup, we might assume empty or we'll backfill manually first if needed.
            But "teams registered via campus lead" implies new ones. 
            Let's try Unique index.
            */
            try {
                await databases.createIndex(DATABASE_ID, TEAMS_COLLECTION_ID, 'team_code_idx', 'unique' as any, ['team_code'], ['ASC']);
                console.log('Created unique index team_code_idx.');
            } catch (idxError: any) {
                console.error('Error creating index (might be due to null values in existing docs):', idxError.message);
            }
        }

        console.log('Schema update complete.');
    } catch (error: any) {
        console.error('Error updating schema:', error);
    }
}

addTeamCodeAttribute();
