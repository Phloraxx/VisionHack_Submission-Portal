// API route to fetch all submitted teams for coordinator dashboard
import { NextRequest, NextResponse } from 'next/server';
import { serverDatabases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite-server';
import { Query } from 'node-appwrite';

// Cache teams list for 60 seconds to reduce database load
export const revalidate = 60;

export async function GET(request: NextRequest) {
  try {
    // Fetch all teams (no status filter)
    const teamsResponse = await serverDatabases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.TEAMS,
      [
        Query.orderDesc('$createdAt'),
        Query.limit(500) // Increased limit
      ]
    );

    // Fetch institution details for each team
    const teamsWithInstitutions = await Promise.all(
      teamsResponse.documents.map(async (team: any) => {
        let institutionName = 'Unknown Institution';
        let institutionDistrict = 'Unknown';
        let institutionId = team.institution_id;

        if (team.institution_id) {
          try {
            const institution = await serverDatabases.getDocument(
              DATABASE_ID,
              COLLECTIONS.INSTITUTIONS,
              team.institution_id
            );
            institutionName = institution.name;
            institutionDistrict = institution.district || 'Unknown';
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
          institutionId,
          district: institutionDistrict,
          status: team.status,
          membersCount: membersResponse.total,
          teamLeadEmail: team.teamLeadEmail || '',
          teamLeadName: team.teamLeadName || '',
          createdAt: team.$createdAt,
          mentorName: team.mentor_name || '',
          mentorContact: team.mentor_contact || '',
          teamCode: team.team_code || ''
        };
      })
    );

    // Calculate statistics
    const districtStats: Record<string, number> = {};
    const institutionStats: Record<string, { name: string; count: number; district: string }> = {};
    const statusStats: Record<string, number> = {};

    teamsWithInstitutions.forEach((team) => {
      // District stats
      districtStats[team.district] = (districtStats[team.district] || 0) + 1;

      // Institution stats
      if (team.institutionId) {
        if (!institutionStats[team.institutionId]) {
          institutionStats[team.institutionId] = {
            name: team.institutionName,
            count: 0,
            district: team.district
          };
        }
        institutionStats[team.institutionId].count++;
      }

      // Status stats
      statusStats[team.status] = (statusStats[team.status] || 0) + 1;
    });

    return NextResponse.json(
      {
        success: true,
        teams: teamsWithInstitutions,
        total: teamsWithInstitutions.length,
        statistics: {
          byDistrict: districtStats,
          byInstitution: Object.entries(institutionStats).map(([id, data]) => ({
            institutionId: id,
            institutionName: data.name,
            district: data.district,
            count: data.count
          })),
          byStatus: statusStats
        }
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
