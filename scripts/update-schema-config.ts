
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
const CONFIG_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_CONFIG_COLLECTION_ID!;

if (!ENDPOINT || !PROJECT_ID || !API_KEY || !DATABASE_ID || !CONFIG_COLLECTION_ID) {
    console.error('Missing environment variables');
    process.exit(1);
}

const client = new Client()
    .setEndpoint(ENDPOINT)
    .setProject(PROJECT_ID)
    .setKey(API_KEY);

const databases = new Databases(client);

async function addConfigAttributes() {
    console.log('Adding attributes to CONFIG collection...');
    const attributes = ['registration', 'nomination', 'submissions'];

    for (const attr of attributes) {
        try {
            await databases.createBooleanAttribute(DATABASE_ID, CONFIG_COLLECTION_ID, attr, false, false);
            console.log(`Created attribute: ${attr}`);
        } catch (e: any) {
            console.log(`Attribute ${attr} might already exist or error:`, e.message);
        }
    }

    console.log('Waiting for attributes to be available...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('Schema update complete.');
}

addConfigAttributes();
