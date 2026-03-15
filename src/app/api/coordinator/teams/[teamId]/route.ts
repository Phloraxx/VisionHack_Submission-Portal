// API route to fetch detailed team information by ID
import { NextRequest, NextResponse } from 'next/server';
import { serverDatabases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite-server';
import { Query } from 'node-appwrite';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;

    if (!teamId) {
      return NextResponse.json(
        { error: 'Team ID is required' },
        { status: 400 }
      );
    }

    // Fetch team details
    const team = await serverDatabases.getDocument(
      DATABASE_ID,
      COLLECTIONS.TEAMS,
      teamId
    );

    // Fetch institution details
    let institutionName = 'Unknown Institution';
    let institutionData = null;

    if (team.institution_id) {
      try {
        const institution = await serverDatabases.getDocument(
          DATABASE_ID,
          COLLECTIONS.INSTITUTIONS,
          team.institution_id
        );
        institutionName = institution.name;
        institutionData = {
          id: institution.$id,
          name: institution.name,
          code: institution.code,
          campusLeadName: institution.campusLeadName,
          campusLeadEmail: institution.campusLeadEmail,
        };
      } catch (error) {
        console.error('Failed to fetch institution:', error);
      }
    }

    // Fetch team members
    const membersResponse = await serverDatabases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.MEMBERS,
      [Query.equal('team_id', teamId)]
    );

    const members = membersResponse.documents.map((member: any) => ({
      id: member.$id,
      fullName: member.full_name,
      email: member.email,
      phone: member.phone,
      gender: member.gender,
      role: member.role,
    }));

    return NextResponse.json({
      success: true,
      team: {
        id: team.$id,
        teamName: team.teamName || team.name || 'Unnamed Team',
        ideaTitle: team.idea_title || 'No Idea Title',
        ideaDesc: team.idea_desc || '',
        techStack: team.idea_tech_stack || '',
        status: team.status,
        teamLeadEmail: team.teamLeadEmail || '',
        teamLeadName: team.teamLeadName || '',
        leaderUserId: team.leader_user_id || '',
        createdAt: team.$createdAt,
        updatedAt: team.$updatedAt,
        mentorName: team.mentor_name || '',
        mentorContact: team.mentor_contact || '',
        submissionFileId: team.submission_file_id || '',
        institution: institutionData,
        institutionName,
        members,
        membersCount: members.length,
        teamCode: team.team_code || '',
      },
    });
  } catch (error: any) {
    console.error('Error fetching team details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team details. Please try again later.' },
      { status: 500 }
    );
  }
}
