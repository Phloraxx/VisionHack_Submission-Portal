// API route to fetch all submitted teams for coordinator dashboard
import { NextRequest, NextResponse } from 'next/server';
import { serverDatabases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite-server';
import { Query } from 'node-appwrite';

// Cache teams list for 60 seconds to reduce database load
export const revalidate = 60;

export async function GET(request: NextRequest) {
  try {
    // Fetch all teams with status = "submitted"
    const teamsResponse = await serverDatabases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.TEAMS,
      [
        Query.equal('status', 'submitted'),
        Query.orderDesc('$createdAt'),
        Query.limit(100) // Adjust limit as needed
      ]
    );

    // Fetch institution details for each team
    const teamsWithInstitutions = await Promise.all(
      teamsResponse.documents.map(async (team: any) => {
        let institutionName = 'Unknown Institution';
        
        if (team.institution_id) {
          try {
            const institution = await serverDatabases.getDocument(
              DATABASE_ID,
              COLLECTIONS.INSTITUTIONS,
              team.institution_id
            );
            institutionName = institution.name;
          } catch (error) {
            console.error(`Failed to fetch institution for team ${team.$id}:`, error);
          }
        }

        // Fetch team members count
        const membersResponse = await serverDatabases.listDocuments(
          DATABASE_ID,
          COLLECTIONS.MEMBERS,
          [Query.equal('team_id', team.$id)]
        );

        return {
          id: team.$id,
          teamName: team.teamName || team.name || 'Unnamed Team',
          ideaTitle: team.idea_title || 'No Idea Title',
          ideaDesc: team.idea_desc || '',
          techStack: team.idea_tech_stack || '',
          institutionName,
          status: team.status,
          membersCount: membersResponse.total,
          teamLeadEmail: team.teamLeadEmail || '',
          createdAt: team.$createdAt,
          mentorName: team.mentor_name || '',
          mentorContact: team.mentor_contact || '',
        };
      })
    );

    return NextResponse.json(
      {
        success: true,
        teams: teamsWithInstitutions,
        total: teamsWithInstitutions.length,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
        },
      }
    );
  } catch (error: any) {
    console.error('Error fetching submitted teams:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch teams' },
      { status: 500 }
    );
  }
}
