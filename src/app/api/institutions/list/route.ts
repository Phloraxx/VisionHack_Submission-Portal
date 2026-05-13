// API route to list all active institutions for public team registration
import { NextRequest, NextResponse } from 'next/server';
import { serverDatabases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite-server';
import { Query } from 'node-appwrite';

export async function GET(request: NextRequest) {
  try {
    // Fetch all active institutions
    const response = await serverDatabases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.INSTITUTIONS,
      [
        Query.equal('status', 'active'),
        Query.orderAsc('name'),
        Query.limit(1000) // Adjust if you have more than 1000 institutions
      ]
    );

    // Return only necessary fields for the dropdown
    const institutions = response.documents.map(doc => ({
      id: doc.$id,
      name: doc.name,
      district: doc.district || 'Unknown'
    }));

    return NextResponse.json({
      success: true,
      institutions
    });
  } catch (error: any) {
    console.error('Error fetching institutions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch institutions' },
      { status: 500 }
    );
  }
}
