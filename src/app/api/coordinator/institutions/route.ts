// API route to fetch all institutions with statistics for coordinator dashboard
import { NextRequest, NextResponse } from 'next/server';
import { serverDatabases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite-server';
import { Query } from 'node-appwrite';

export const revalidate = 60;

export async function GET(request: NextRequest) {
  try {
    // Fetch all institutions
    const institutionsResponse = await serverDatabases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.INSTITUTIONS,
      [
        Query.orderDesc('$createdAt'),
        Query.limit(500)
      ]
    );

    // Fetch all teams to calculate statistics
    const teamsResponse = await serverDatabases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.TEAMS,
      [Query.limit(1000)]
    );

    // Calculate statistics for each institution
    const institutionsWithStats = institutionsResponse.documents.map((inst: any) => {
      const institutionTeams = teamsResponse.documents.filter((team: any) => team.institution_id === inst.$id);
      const registeredCount = institutionTeams.filter((team: any) => team.status === 'registered').length;
      const waitlistedCount = institutionTeams.filter((team: any) => team.status === 'waitlisted').length;
      const submittedCount = institutionTeams.filter((team: any) => team.status === 'submitted').length;

      return {
        id: inst.$id,
        name: inst.name,
        code: inst.code,
        district: inst.district || 'Unknown',
        email: inst.email,
        campusLeadName: inst.campusLeadName || 'Unknown',
        campusLeadEmail: inst.campusLeadEmail || inst.email,
        totalTeams: institutionTeams.length,
        registeredTeams: registeredCount,
        waitlistedTeams: waitlistedCount,
        submittedTeams: submittedCount,
        maxTeams: inst.maxTeams || 5,
        status: inst.status || 'active'
      };
    });

    return NextResponse.json(
      {
        success: true,
        institutions: institutionsWithStats,
        total: institutionsWithStats.length,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
        },
      }
    );
  } catch (error: any) {
    console.error('Error fetching institutions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch institutions' },
      { status: 500 }
    );
  }
}
