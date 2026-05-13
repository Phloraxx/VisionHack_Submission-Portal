// API route to bulk create campus leads from CSV
import { NextRequest, NextResponse } from 'next/server';
import { bulkCreateCampusLeads } from '@/lib/auth-service';
import { bulkSendEmails } from '@/lib/email-service';
import { serverDatabases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite-server';
import { ID } from 'node-appwrite';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { leads } = body; // Array of { collegeName, campusLeadName, email, district }
    
    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json(
        { error: 'Invalid leads data' },
        { status: 400 }
      );
    }

    // Validate that all leads have district field
    const missingDistrict = leads.filter(lead => !lead.district);
    if (missingDistrict.length > 0) {
      return NextResponse.json(
        { error: 'All institutions must have a district specified' },
        { status: 400 }
      );
    }
    
    // Step 1: Create user accounts
    console.log(`Creating ${leads.length} campus lead accounts...`);
    const userResults = await bulkCreateCampusLeads(leads);
    
    // Step 2: Create institution documents in database
    const institutionDocs = [];
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      const userResult = userResults[i];
      
      if (userResult.success) {
        try {
          const doc = await serverDatabases.createDocument(
            DATABASE_ID,
            COLLECTIONS.INSTITUTIONS,
            ID.unique(),
            {
              name: lead.collegeName,
              code: lead.collegeName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 50).toUpperCase(),
              email: lead.email,
              district: lead.district,
              is_nominated_locked: false,
              campusLeadId: userResult.userId,
              campusLeadName: lead.campusLeadName,
              campusLeadEmail: lead.email,
              teamsRegistered: 0,
              teamsShortlisted: 0,
              maxTeams: 5,
              status: 'active',
              createdAt: new Date().toISOString(),
              lastUpdated: new Date().toISOString()
            }
          );
          institutionDocs.push(doc);
        } catch (error) {
          console.error(`Failed to create institution doc for ${lead.collegeName}:`, error);
        }
      }
    }
    
    // Step 3: Send emails to all successful accounts
    const emailParams = userResults
      .filter(result => result.success)
      .map((result, index) => ({
        to: result.email,
        name: result.name,
        email: result.email,
        password: result.password,
        role: 'campus_lead' as const,
        institutionName: leads[index].collegeName
      }));
    
    console.log(`Sending ${emailParams.length} emails...`);
    const emailsSent = await bulkSendEmails(emailParams);
    
    return NextResponse.json({
      success: true,
      accountsCreated: userResults.filter(r => r.success).length,
      institutionsCreated: institutionDocs.length,
      emailsSent,
      total: leads.length,
      results: userResults.map((result, index) => ({
        collegeName: leads[index].collegeName,
        email: result.email,
        success: result.success,
        error: result.error
      }))
    });
  } catch (error: any) {
    console.error('Error in bulk create campus leads:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create campus leads' },
      { status: 500 }
    );
  }
}
