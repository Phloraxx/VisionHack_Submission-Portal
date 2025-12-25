/**
 * Complete Appwrite Database Setup Script
 * 
 * This script creates ALL required collections and storage buckets:
 * Collections:
 * - institutions: College information (~250 colleges)
 * - teams: Team registration and submissions (linked to institution)
 * - members: Team member details (4 per team, linked to team AND institution)
 * - config: Global event switches
 * - themes: Dynamic hackathon themes
 * - gallery: Gallery images
 * 
 * Storage Buckets:
 * - submissions: Idea PPTs/PDFs (10MB limit)
 * - assets: Gallery images and theme icons
 * 
 * Run this script once to set up your complete database structure.
 * 
 * Usage: npm run setup-db
 */

import { Client, Databases, Storage, Permission, Role } from 'node-appwrite';
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

// Configuration
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

// Initialize clients
const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new Databases(client);
const storage = new Storage(client);

// Console colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function createInstitutionsCollection() {
  log('\n📚 Creating "institutions" collection...', 'cyan');

  try {
    await databases.createCollection(
      DATABASE_ID,
      INSTITUTIONS_COLLECTION_ID,
      'Institutions',
      [
        Permission.read(Role.any()),
        Permission.create(Role.label('admin')),
        Permission.update(Role.label('admin')),
        Permission.update(Role.label('institution')),
        Permission.delete(Role.label('admin')),
      ]
    );
    log('✓ Collection created', 'green');

    log('  Adding attributes...', 'blue');

    await databases.createStringAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'name', 255, true);
    log('    ✓ name (string, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'code', 50, true);
    log('    ✓ code (string, required, unique)', 'green');

    await databases.createEmailAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'email', true);
    log('    ✓ email (email, required)', 'green');

    await databases.createBooleanAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'is_nominated_locked', false, false);
    log('    ✓ is_nominated_locked (boolean, default: false)', 'green');

    // Legacy cascade inviting fields
    await databases.createStringAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'campusLeadId', 255, false);
    await databases.createStringAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'campusLeadName', 255, false);
    await databases.createEmailAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'campusLeadEmail', false);
    await databases.createIntegerAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'teamsRegistered', false, 0, undefined, 0);
    await databases.createIntegerAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'teamsShortlisted', false, 0, undefined, 0);
    await databases.createIntegerAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'maxTeams', false, 1, undefined, 5);
    await databases.createStringAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'status', 50, false, 'active');
    await databases.createDatetimeAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'createdAt', false);
    await databases.createDatetimeAttribute(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'lastUpdated', false);
    log('    ✓ Legacy cascade inviting fields added', 'green');

    log('  Waiting for attributes...', 'yellow');
    await new Promise(resolve => setTimeout(resolve, 3000));

    log('  Creating indexes...', 'blue');
    await databases.createIndex(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'code_idx', 'unique', ['code'], ['ASC']);
    log('    ✓ code_idx (unique)', 'green');
    
    await databases.createIndex(DATABASE_ID, INSTITUTIONS_COLLECTION_ID, 'email_idx', 'key', ['email'], ['ASC']);
    log('    ✓ email_idx', 'green');

    log('✅ "institutions" collection created successfully!', 'bright');
    return true;
  } catch (error: any) {
    if (error.code === 409) {
      log('⚠️  Collection "institutions" already exists', 'yellow');
      return false;
    }
    log(`❌ Error: ${error.message}`, 'red');
    throw error;
  }
}

async function createTeamsCollection() {
  log('\n📚 Creating "teams" collection...', 'cyan');

  try {
    await databases.createCollection(
      DATABASE_ID,
      TEAMS_COLLECTION_ID,
      'Teams',
      [
        Permission.read(Role.any()),
        Permission.create(Role.label('admin')),
        Permission.create(Role.label('institution')),
        Permission.create(Role.label('lead')),
        Permission.update(Role.label('admin')),
        Permission.update(Role.label('lead')),
        Permission.delete(Role.label('admin')),
      ]
    );
    log('✓ Collection created', 'green');

    log('  Adding attributes...', 'blue');

    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'name', 255, true);
    log('    ✓ name (string, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'leader_user_id', 255, true);
    log('    ✓ leader_user_id (string, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'institution_id', 255, true);
    log('    ✓ institution_id (string, required)', 'green');

    await databases.createEnumAttribute(
      DATABASE_ID,
      TEAMS_COLLECTION_ID,
      'status',
      ['registered', 'nominated', 'submitted', 'selected', 'rejected', 'waitlisted'],
      false,
      'registered'
    );
    log('    ✓ status (enum, default: registered)', 'green');

    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'idea_title', 255, false);
    log('    ✓ idea_title (string)', 'green');

    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'idea_desc', 5000, false);
    log('    ✓ idea_desc (string, long text)', 'green');

    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'idea_tech_stack', 1000, false);
    log('    ✓ idea_tech_stack (string)', 'green');

    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'submission_file_id', 255, false);
    log('    ✓ submission_file_id (string)', 'green');

    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'mentor_name', 255, false);
    log('    ✓ mentor_name (string)', 'green');

    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'mentor_contact', 255, false);
    log('    ✓ mentor_contact (string)', 'green');

    // Legacy cascade inviting fields
    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'institutionName', 255, false);
    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'teamLeadId', 255, false);
    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'teamLeadName', 255, false);
    await databases.createEmailAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'teamLeadEmail', false);
    await databases.createStringAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'teamName', 255, false);
    await databases.createIntegerAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'membersCount', false, 0, undefined, 0);
    await databases.createDatetimeAttribute(DATABASE_ID, TEAMS_COLLECTION_ID, 'createdAt', false);
    log('    ✓ Legacy cascade inviting fields added', 'green');

    log('  Waiting for attributes...', 'yellow');
    await new Promise(resolve => setTimeout(resolve, 3000));

    log('  Creating indexes...', 'blue');
    await databases.createIndex(DATABASE_ID, TEAMS_COLLECTION_ID, 'institution_idx', 'key', ['institution_id'], ['ASC']);
    log('    ✓ institution_idx', 'green');

    await databases.createIndex(DATABASE_ID, TEAMS_COLLECTION_ID, 'leader_idx', 'key', ['leader_user_id'], ['ASC']);
    log('    ✓ leader_idx', 'green');

    await databases.createIndex(DATABASE_ID, TEAMS_COLLECTION_ID, 'status_idx', 'key', ['status'], ['ASC']);
    log('    ✓ status_idx', 'green');

    log('✅ "teams" collection created successfully!', 'bright');
    return true;
  } catch (error: any) {
    if (error.code === 409) {
      log('⚠️  Collection "teams" already exists', 'yellow');
      return false;
    }
    log(`❌ Error: ${error.message}`, 'red');
    throw error;
  }
}

async function createMembersCollection() {
  log('\n📚 Creating "members" collection...', 'cyan');

  try {
    await databases.createCollection(
      DATABASE_ID,
      MEMBERS_COLLECTION_ID,
      'Members',
      [
        Permission.read(Role.any()),
        Permission.create(Role.label('lead')),
        Permission.update(Role.label('admin')),
        Permission.update(Role.label('lead')),
        Permission.delete(Role.label('admin')),
      ]
    );
    log('✓ Collection created', 'green');

    log('  Adding attributes...', 'blue');

    await databases.createStringAttribute(DATABASE_ID, MEMBERS_COLLECTION_ID, 'team_id', 255, true);
    log('    ✓ team_id (string, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, MEMBERS_COLLECTION_ID, 'institution_id', 255, true);
    log('    ✓ institution_id (string, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, MEMBERS_COLLECTION_ID, 'institution_name', 255, true);
    log('    ✓ institution_name (string, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, MEMBERS_COLLECTION_ID, 'full_name', 255, true);
    log('    ✓ full_name (string, required)', 'green');

    await databases.createEmailAttribute(DATABASE_ID, MEMBERS_COLLECTION_ID, 'email', true);
    log('    ✓ email (email, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, MEMBERS_COLLECTION_ID, 'phone', 20, true);
    log('    ✓ phone (string, required)', 'green');

    await databases.createEnumAttribute(
      DATABASE_ID,
      MEMBERS_COLLECTION_ID,
      'gender',
      ['Male', 'Female', 'Other'],
      true
    );
    log('    ✓ gender (enum, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, MEMBERS_COLLECTION_ID, 'role', 100, true);
    log('    ✓ role (string, required)', 'green');

    log('  Waiting for attributes...', 'yellow');
    await new Promise(resolve => setTimeout(resolve, 2000));

    log('  Creating indexes...', 'blue');
    await databases.createIndex(DATABASE_ID, MEMBERS_COLLECTION_ID, 'team_idx', 'key', ['team_id'], ['ASC']);
    log('    ✓ team_idx', 'green');

    await databases.createIndex(DATABASE_ID, MEMBERS_COLLECTION_ID, 'institution_idx', 'key', ['institution_id'], ['ASC']);
    log('    ✓ institution_idx', 'green');

    log('✅ "members" collection created successfully!', 'bright');
    return true;
  } catch (error: any) {
    if (error.code === 409) {
      log('⚠️  Collection "members" already exists', 'yellow');
      return false;
    }
    log(`❌ Error: ${error.message}`, 'red');
    throw error;
  }
}

async function createConfigCollection() {
  log('\n📚 Creating "config" collection...', 'cyan');

  try {
    await databases.createCollection(
      DATABASE_ID,
      CONFIG_COLLECTION_ID,
      'Config',
      [
        Permission.read(Role.any()),
        Permission.create(Role.label('admin')),
        Permission.update(Role.label('admin')),
        Permission.delete(Role.label('admin')),
      ]
    );
    log('✓ Collection created', 'green');

    log('  Adding attributes...', 'blue');

    await databases.createStringAttribute(DATABASE_ID, CONFIG_COLLECTION_ID, 'key', 100, true);
    log('    ✓ key (string, required)', 'green');

    await databases.createBooleanAttribute(DATABASE_ID, CONFIG_COLLECTION_ID, 'value_bool', false);
    log('    ✓ value_bool (boolean)', 'green');

    await databases.createStringAttribute(DATABASE_ID, CONFIG_COLLECTION_ID, 'value_text', 1000, false);
    log('    ✓ value_text (string)', 'green');

    log('  Waiting for attributes...', 'yellow');
    await new Promise(resolve => setTimeout(resolve, 2000));

    log('  Creating indexes...', 'blue');
    await databases.createIndex(DATABASE_ID, CONFIG_COLLECTION_ID, 'key_idx', 'unique', ['key'], ['ASC']);
    log('    ✓ key_idx (unique)', 'green');

    log('✅ "config" collection created successfully!', 'bright');
    return true;
  } catch (error: any) {
    if (error.code === 409) {
      log('⚠️  Collection "config" already exists', 'yellow');
      return false;
    }
    log(`❌ Error: ${error.message}`, 'red');
    throw error;
  }
}

async function createThemesCollection() {
  log('\n📚 Creating "themes" collection...', 'cyan');

  try {
    await databases.createCollection(
      DATABASE_ID,
      THEMES_COLLECTION_ID,
      'Themes',
      [
        Permission.read(Role.any()),
        Permission.create(Role.label('admin')),
        Permission.update(Role.label('admin')),
        Permission.delete(Role.label('admin')),
      ]
    );
    log('✓ Collection created', 'green');

    log('  Adding attributes...', 'blue');

    await databases.createStringAttribute(DATABASE_ID, THEMES_COLLECTION_ID, 'title', 255, true);
    log('    ✓ title (string, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, THEMES_COLLECTION_ID, 'description', 1000, true);
    log('    ✓ description (string, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, THEMES_COLLECTION_ID, 'relevance', 1000, false);
    log('    ✓ relevance (string)', 'green');

    await databases.createStringAttribute(DATABASE_ID, THEMES_COLLECTION_ID, 'problem_area', 500, false);
    log('    ✓ problem_area (string)', 'green');

    log('✅ "themes" collection created successfully!', 'bright');
    return true;
  } catch (error: any) {
    if (error.code === 409) {
      log('⚠️  Collection "themes" already exists', 'yellow');
      return false;
    }
    log(`❌ Error: ${error.message}`, 'red');
    throw error;
  }
}

async function createGalleryCollection() {
  log('\n📚 Creating "gallery" collection...', 'cyan');

  try {
    await databases.createCollection(
      DATABASE_ID,
      GALLERY_COLLECTION_ID,
      'Gallery',
      [
        Permission.read(Role.any()),
        Permission.create(Role.label('admin')),
        Permission.update(Role.label('admin')),
        Permission.delete(Role.label('admin')),
      ]
    );
    log('✓ Collection created', 'green');

    log('  Adding attributes...', 'blue');

    await databases.createStringAttribute(DATABASE_ID, GALLERY_COLLECTION_ID, 'image_file_id', 255, true);
    log('    ✓ image_file_id (string, required)', 'green');

    await databases.createStringAttribute(DATABASE_ID, GALLERY_COLLECTION_ID, 'caption', 500, false);
    log('    ✓ caption (string)', 'green');

    log('✅ "gallery" collection created successfully!', 'bright');
    return true;
  } catch (error: any) {
    if (error.code === 409) {
      log('⚠️  Collection "gallery" already exists', 'yellow');
      return false;
    }
    log(`❌ Error: ${error.message}`, 'red');
    throw error;
  }
}

async function createSubmissionsBucket() {
  log('\n🗂️  Creating "submissions" bucket...', 'magenta');

  try {
    await storage.createBucket(
      SUBMISSIONS_BUCKET_ID,
      'Submissions',
      [
        Permission.read(Role.label('admin')),
        Permission.read(Role.label('institution')),
        Permission.create(Role.label('lead')),
        Permission.update(Role.label('admin')),
        Permission.delete(Role.label('admin')),
      ],
      true, // fileSecurity - enable file-level security
      true, // enabled
      10485760, // 10MB max file size
      ['pdf', 'ppt', 'pptx'], // allowed file extensions
      'none', // compression
      false, // encryption
      true // antivirus
    );
    log('✓ Bucket created (10MB limit, PDF/PPT only)', 'green');
    log('✅ "submissions" bucket created successfully!', 'bright');
    return true;
  } catch (error: any) {
    if (error.code === 409) {
      log('⚠️  Bucket "submissions" already exists', 'yellow');
      return false;
    }
    log(`❌ Error: ${error.message}`, 'red');
    throw error;
  }
}

async function createAssetsBucket() {
  log('\n🗂️  Creating "assets" bucket...', 'magenta');

  try {
    await storage.createBucket(
      ASSETS_BUCKET_ID,
      'Assets',
      [
        Permission.read(Role.any()),
        Permission.create(Role.label('admin')),
        Permission.update(Role.label('admin')),
        Permission.delete(Role.label('admin')),
      ],
      false, // fileSecurity - public read access
      true, // enabled
      5242880, // 5MB max file size
      ['png', 'jpeg', 'jpg', 'webp', 'gif'], // allowed file extensions
      'gzip', // compression
      false, // encryption
      false // antivirus
    );
    log('✓ Bucket created (5MB limit, images only)', 'green');
    log('✅ "assets" bucket created successfully!', 'bright');
    return true;
  } catch (error: any) {
    if (error.code === 409) {
      log('⚠️  Bucket "assets" already exists', 'yellow');
      return false;
    }
    log(`❌ Error: ${error.message}`, 'red');
    throw error;
  }
}

async function seedConfigData() {
  log('\n🌱 Seeding config data...', 'cyan');

  const configs = [
    { key: 'registration_open', value_bool: true, value_text: '' },
    { key: 'nomination_open', value_bool: false, value_text: '' },
    { key: 'submission_open', value_bool: false, value_text: '' },
  ];

  for (const config of configs) {
    try {
      await databases.createDocument(
        DATABASE_ID,
        CONFIG_COLLECTION_ID,
        config.key,
        config
      );
      log(`  ✓ Created config: ${config.key} = ${config.value_bool}`, 'green');
    } catch (error: any) {
      if (error.code === 409) {
        log(`  ⚠️  Config "${config.key}" already exists`, 'yellow');
      } else {
        log(`  ❌ Error creating config "${config.key}": ${error.message}`, 'red');
      }
    }
  }
  log('✅ Config seeding completed!', 'bright');
}

async function verifySetup() {
  log('\n🔍 Verifying setup...', 'cyan');

  try {
    const institutions = await databases.getCollection(DATABASE_ID, INSTITUTIONS_COLLECTION_ID);
    log(`✓ institutions: ${institutions.name} (${institutions.attributes?.length || 0} attributes)`, 'green');

    const teams = await databases.getCollection(DATABASE_ID, TEAMS_COLLECTION_ID);
    log(`✓ teams: ${teams.name} (${teams.attributes?.length || 0} attributes)`, 'green');

    const members = await databases.getCollection(DATABASE_ID, MEMBERS_COLLECTION_ID);
    log(`✓ members: ${members.name} (${members.attributes?.length || 0} attributes)`, 'green');

    const config = await databases.getCollection(DATABASE_ID, CONFIG_COLLECTION_ID);
    log(`✓ config: ${config.name} (${config.attributes?.length || 0} attributes)`, 'green');

    const themes = await databases.getCollection(DATABASE_ID, THEMES_COLLECTION_ID);
    log(`✓ themes: ${themes.name} (${themes.attributes?.length || 0} attributes)`, 'green');

    const gallery = await databases.getCollection(DATABASE_ID, GALLERY_COLLECTION_ID);
    log(`✓ gallery: ${gallery.name} (${gallery.attributes?.length || 0} attributes)`, 'green');

    const submissions = await storage.getBucket(SUBMISSIONS_BUCKET_ID);
    log(`✓ submissions bucket: ${submissions.name} (${submissions.maximumFileSize / 1048576}MB limit)`, 'green');

    const assets = await storage.getBucket(ASSETS_BUCKET_ID);
    log(`✓ assets bucket: ${assets.name} (${assets.maximumFileSize / 1048576}MB limit)`, 'green');

    log('\n✅ All collections and buckets verified successfully!', 'bright');
    return true;
  } catch (error: any) {
    log(`❌ Error verifying setup: ${error.message}`, 'red');
    return false;
  }
}

async function main() {
  log('\n🚀 Starting Complete Appwrite Database Setup...', 'bright');
  log('━'.repeat(60), 'blue');

  // Verify configuration
  if (!ENDPOINT || !PROJECT_ID || !API_KEY || !DATABASE_ID) {
    log('❌ Missing required environment variables!', 'red');
    log('Please ensure these are set in .env.local:', 'yellow');
    log('  - NEXT_PUBLIC_APPWRITE_ENDPOINT', 'yellow');
    log('  - NEXT_PUBLIC_APPWRITE_PROJECT_ID', 'yellow');
    log('  - APPWRITE_API_KEY', 'yellow');
    log('  - NEXT_PUBLIC_APPWRITE_DATABASE_ID', 'yellow');
    process.exit(1);
  }

  log(`\n📡 Endpoint: ${ENDPOINT}`, 'blue');
  log(`📦 Project: ${PROJECT_ID}`, 'blue');
  log(`🗄️  Database: ${DATABASE_ID}`, 'blue');

  try {
    // Create collections
    await createInstitutionsCollection();
    await createTeamsCollection();
    await createMembersCollection();
    await createConfigCollection();
    await createThemesCollection();
    await createGalleryCollection();

    // Create storage buckets
    await createSubmissionsBucket();
    await createAssetsBucket();

    // Seed initial config data
    await seedConfigData();

    // Verify everything
    await verifySetup();

    log('\n' + '━'.repeat(60), 'blue');
    log('🎉 Complete database setup successful!', 'bright');
    log('\nWhat you can do now:', 'cyan');
    log('  1. ✅ 6 Collections created', 'cyan');
    log('  2. ✅ 2 Storage buckets created', 'cyan');
    log('  3. ✅ Config data seeded', 'cyan');
    log('  4. ✅ Ready for team registrations!', 'cyan');
    log('\n✨ VisionHack 2026 Portal is ready!', 'green');
  } catch (error: any) {
    log('\n' + '━'.repeat(60), 'blue');
    log('❌ Database setup failed!', 'red');
    log(`Error: ${error.message}`, 'red');
    log('\n💡 Tip: Check API-KEY-FIX.md for permission issues', 'yellow');
    process.exit(1);
  }
}

// Run the setup
main();
