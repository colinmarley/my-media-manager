/**
 * Migration Script: Add titleLower field to movies and series collections
 * 
 * This script adds a lowercase version of the title field to all existing
 * movies and series documents in Firestore for efficient case-insensitive search.
 * 
 * Usage:
 *   npx ts-node scripts/add-titlelower-field.ts
 * 
 * Or compile and run:
 *   npx tsc scripts/add-titlelower-field.ts && node scripts/add-titlelower-field.js
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin SDK
// Make sure you have a service account key JSON file
const serviceAccountPath = path.join(__dirname, '../service-account-key.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Service account key not found at:', serviceAccountPath);
  console.error('Please download your service account key from Firebase Console:');
  console.error('Project Settings > Service Accounts > Generate New Private Key');
  process.exit(1);
}

// Read and parse the service account key
const serviceAccountContent = fs.readFileSync(serviceAccountPath, 'utf8');
const serviceAccount = JSON.parse(serviceAccountContent);

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

/**
 * Add titleLower field to a collection
 */
async function addTitleLowerToCollection(collectionName: string): Promise<void> {
  console.log(`\n🔄 Processing ${collectionName} collection...`);
  
  try {
    const collectionRef = db.collection(collectionName);
    const snapshot = await collectionRef.get();
    
    if (snapshot.empty) {
      console.log(`ℹ️  No documents found in ${collectionName} collection`);
      return;
    }
    
    console.log(`📊 Found ${snapshot.size} documents in ${collectionName}`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Use batched writes for efficiency (max 500 per batch)
    const batchSize = 500;
    let batch = db.batch();
    let operationsInBatch = 0;
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      
      // Skip if titleLower already exists
      if (data.titleLower) {
        skippedCount++;
        continue;
      }
      
      // Skip if no title field
      if (!data.title) {
        console.warn(`⚠️  Document ${doc.id} has no title field, skipping`);
        errorCount++;
        continue;
      }
      
      // Add titleLower field
      batch.update(doc.ref, {
        titleLower: data.title.toLowerCase()
      });
      
      operationsInBatch++;
      updatedCount++;
      
      // Commit batch if we reach the limit
      if (operationsInBatch >= batchSize) {
        await batch.commit();
        console.log(`✅ Committed batch of ${operationsInBatch} updates`);
        batch = db.batch();
        operationsInBatch = 0;
      }
    }
    
    // Commit any remaining operations
    if (operationsInBatch > 0) {
      await batch.commit();
      console.log(`✅ Committed final batch of ${operationsInBatch} updates`);
    }
    
    console.log(`\n✅ ${collectionName} migration complete:`);
    console.log(`   - Updated: ${updatedCount}`);
    console.log(`   - Skipped (already had titleLower): ${skippedCount}`);
    console.log(`   - Errors: ${errorCount}`);
    
  } catch (error) {
    console.error(`❌ Error processing ${collectionName}:`, error);
    throw error;
  }
}

/**
 * Main migration function
 */
async function runMigration(): Promise<void> {
  console.log('🚀 Starting titleLower field migration...\n');
  
  try {
    // Migrate movies collection
    await addTitleLowerToCollection('movies');
    
    // Migrate series collection
    await addTitleLowerToCollection('series');
    
    console.log('\n✅ Migration completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Deploy the updated Firestore indexes:');
    console.log('      firebase deploy --only firestore:indexes');
    console.log('   2. Wait for indexes to build in Firebase Console');
    console.log('   3. Test the search functionality');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
runMigration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
