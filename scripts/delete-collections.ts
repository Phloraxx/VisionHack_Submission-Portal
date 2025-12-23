/**
 * Appwrite Database Cleanup Script
 * 
 * This script deletes all collections and storage buckets created by the setup script.
 * Use this if you need to reset your database or fix issues.
 * 
 * ⚠️  WARNING: This will delete ALL data in the collections and ALL files in buckets!
 * 
 * Usage:
 *   npm run delete-db
 */

import { Client, Databases, Storage } from 'node-appwrite';
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

// Load environment variables
loadEnvFile();

// Configuration from environment variables
const ENDPOINT = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!;
const PROJECT_ID = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!;
const API_KEY = process.env.APPWRITE_API_KEY!;
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;

const INSTITUTIONS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_INSTITUTIONS_COLLECTION_ID!;
const TEAMS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_TEAMS_COLLECTION_ID!;
const MEMBERS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_MEMBERS_COLLECTION_ID!;
const CONFIG_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_CONFIG_COLLECTION_ID!;
const THEMES_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_THEMES_COLLECTION_ID!;
const GALLERY_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_GALLERY_COLLECTION_ID!;

const SUBMISSIONS_BUCKET_ID = process.env.NEXT_PUBLIC_APPWRITE_SUBMISSIONS_BUCKET_ID!;
const ASSETS_BUCKET_ID = process.env.NEXT_PUBLIC_APPWRITE_ASSETS_BUCKET_ID!;

// Initialize Appwrite client
const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);
const storage = new Storage(client);

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function deleteCollection(collectionId: string, collectionName: string) {
  try {
    await databases.deleteCollection(DATABASE_ID, collectionId);
    log(`✓ Deleted "${collectionName}" collection`, 'green');
    return true;
  } catch (error: any) {
    if (error.code === 404) {
      log(`⚠️  Collection "${collectionName}" not found (already deleted?)`, 'yellow');
      return false;
    }
    log(`❌ Error deleting "${collectionName}": ${error.message}`, 'red');
    throw error;
  }
}

async function deleteBucket(bucketId: string, bucketName: string) {
  try {
    await storage.deleteBucket(bucketId);
    log(`✓ Deleted "${bucketName}" bucket`, 'green');
    return true;
  } catch (error: any) {
    if (error.code === 404) {
      log(`⚠️  Bucket "${bucketName}" not found (already deleted?)`, 'yellow');
      return false;
    }
    log(`❌ Error deleting "${bucketName}": ${error.message}`, 'red');
    throw error;
  }
}

async function main() {
  log('\n🗑️  Starting Appwrite Database Cleanup...', 'bright');
  log('━'.repeat(50), 'red');

  // Verify configuration
  if (!ENDPOINT || !PROJECT_ID || !API_KEY || !DATABASE_ID) {
    log('❌ Missing required environment variables!', 'red');
    process.exit(1);
  }

  log('\n⚠️  WARNING: This will DELETE all collections and buckets!', 'red');
  log('Collections to be deleted:', 'yellow');
  log(`  - institutions`, 'yellow');
  log(`  - teams`, 'yellow');
  log(`  - members`, 'yellow');
  log(`  - config`, 'yellow');
  log(`  - themes`, 'yellow');
  log(`  - gallery`, 'yellow');
  log('Storage buckets to be deleted:', 'yellow');
  log(`  - submissions`, 'yellow');
  log(`  - assets`, 'yellow');

  // Give user time to cancel (Ctrl+C)
  log('\nDeleting in 3 seconds... (Press Ctrl+C to cancel)', 'red');
  await new Promise(resolve => setTimeout(resolve, 1000));
  log('2...', 'red');
  await new Promise(resolve => setTimeout(resolve, 1000));
  log('1...', 'red');
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    log('\n🗑️  Deleting collections...', 'cyan');
    
    await deleteCollection(TEAMS_COLLECTION_ID, 'teams');
    await deleteCollection(INSTITUTIONS_COLLECTION_ID, 'institutions');
    await deleteCollection(MEMBERS_COLLECTION_ID, 'members');
    await deleteCollection(CONFIG_COLLECTION_ID, 'config');
    await deleteCollection(THEMES_COLLECTION_ID, 'themes');
    await deleteCollection(GALLERY_COLLECTION_ID, 'gallery');

    log('\n🗑️  Deleting storage buckets...', 'cyan');
    
    await deleteBucket(SUBMISSIONS_BUCKET_ID, 'submissions');
    await deleteBucket(ASSETS_BUCKET_ID, 'assets');

    log('\n' + '━'.repeat(50), 'red');
    log('✅ Database cleanup completed!', 'bright');
    log('\nYou can now run setup-database.ts to recreate everything.', 'cyan');
  } catch (error: any) {
    log('\n' + '━'.repeat(50), 'red');
    log('❌ Database cleanup failed!', 'red');
    log(`Error: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Run the cleanup
main();
