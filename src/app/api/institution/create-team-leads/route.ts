// API route to create team leads (cascade inviting)
import { NextRequest, NextResponse } from 'next/server';
import { createTeamLeads } from '@/lib/auth-service';
import { bulkSendEmails } from '@/lib/email-service';
import { serverDatabases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite-server';
import { ID, Query } from 'node-appwrite';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { institutionId, teamLeads } = body; // Array of { name, email }

    if (!institutionId || !Array.isArray(teamLeads) || teamLeads.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    // Validate maximum 5 team leads - REMOVED for unlimited invites
    // if (teamLeads.length > 5) {
    //   return NextResponse.json(
    //     { error: 'Maximum 5 team leads allowed per institution' },
    //     { status: 400 }
    //   );
    // }

    // Check Event Configuration
    const configDocs = await serverDatabases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.CONFIG
    );

    const registrationConfig = configDocs.documents.find((d: any) => d.key === 'registration_open');
    const isRegistrationOpen = registrationConfig ? registrationConfig.value_bool : false;

    if (!isRegistrationOpen) {
      return NextResponse.json({ error: 'Team registration is currently closed.' }, { status: 403 });
    }

    // Get institution details
    let institution;
    try {
      institution = await serverDatabases.getDocument(
        DATABASE_ID,
        COLLECTIONS.INSTITUTIONS,
        institutionId
      );
    } catch (error) {
      return NextResponse.json(
        { error: 'Institution not found' },
        { status: 404 }
      );
    }

    // Step 1: Create team lead accounts
    console.log(`Creating ${teamLeads.length} team lead accounts for ${institution.name}...`);
    const userResults = await createTeamLeads(teamLeads, institutionId);

    // Generate a random 4-digit code function
    const generateTeamCode = () => {
      // 1000 to 9999
      return Math.floor(1000 + Math.random() * 9000).toString();
    };

    // Step 2: Create team documents in database
    const teamDocs = [];
    for (let i = 0; i < teamLeads.length; i++) {
      const lead = teamLeads[i];
      const userResult = userResults[i];

      if (userResult.success) {
        try {
          const teamCode = generateTeamCode();

          const doc = await serverDatabases.createDocument(
            DATABASE_ID,
            COLLECTIONS.TEAMS,
            ID.unique(),
            {
              name: '', // To be filled by team lead
              leader_user_id: userResult.userId,
              institution_id: institutionId,
              status: 'waitlisted', // Default status is now waitlisted until approved by Campus Lead
              institutionName: institution.name,
              teamLeadId: userResult.userId,
              teamLeadName: lead.name,
              teamLeadEmail: lead.email,
              teamName: '',
              membersCount: 0,
              createdAt: new Date().toISOString(),
              team_code: teamCode // Add unique code
            }
          );
          teamDocs.push(doc);
        } catch (error) {
          console.error(`Failed to create team doc for ${lead.name}:`, error);
        }
      }
    }

    // Step 3: Update institution's registered count
    try {
      const currentRegistered = institution.teamsRegistered || 0;
      await serverDatabases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.INSTITUTIONS,
        institutionId,
        {
          teamsRegistered: currentRegistered + teamDocs.length,
          lastUpdated: new Date().toISOString()
        }
      );
    } catch (error) {
      console.error('Failed to update institution:', error);
    }

    // Step 4: Send emails to all successful accounts
    const emailParams = userResults
      .filter(result => result.success)
      .map((result, index) => ({
        to: result.email,
        name: result.name,
        email: result.email,
        password: result.password,
        role: 'team_lead' as const,
        institutionName: institution.name
      }));

    console.log(`Sending ${emailParams.length} emails...`);
    const emailsSent = await bulkSendEmails(emailParams);

    return NextResponse.json({
      success: true,
      accountsCreated: userResults.filter(r => r.success).length,
      teamsCreated: teamDocs.length,
      emailsSent,
      total: teamLeads.length,
      results: userResults.map((result, index) => ({
        name: teamLeads[index].name,
        email: result.email,
        success: result.success,
        error: result.error
      }))
    });
  } catch (error: any) {
    console.error('Error in create team leads:', error);
    return NextResponse.json(
      { error: 'Failed to create team leads. Please check the data and try again.' },
      { status: 500 }
    );
  }
}
