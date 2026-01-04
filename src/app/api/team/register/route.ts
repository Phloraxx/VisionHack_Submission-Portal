/**
 * Team Registration API Route
 * 
 * Purpose: Allows team leads to register their team with members
 * 
 * Flow:
 * 1. Team lead is created by campus lead (via cascade inviting)
 * 2. A team document is pre-created with leader_user_id but no team details
 * 3. Team lead logs in and fills the registration form
 * 4. This API updates the team document with all details
 * 5. Creates member documents for each team member
 * 6. Updates institution statistics
 * 
 * Frontend Form Fields:
 * - Team Information:
 *   - teamName (required)
 *   - ideaTitle (optional)
 *   - ideaDescription (optional)
 *   - techStack (optional)
 *   - mentorName (optional)
 *   - mentorContact (optional)
 * - Team Members (1-5 members):
 *   - fullName (required)
 *   - email (required)
 *   - phone (required)
 *   - gender (required: Male/Female/Other)
 *   - role (required: e.g., Developer, Designer)
 */

import { NextRequest, NextResponse } from 'next/server';
import { serverDatabases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite-server';
import { ID, Query } from 'node-appwrite';

// Types for better code clarity
interface TeamMember {
  fullName: string;
  email: string;
  phone: string;
  gender: 'Male' | 'Female' | 'Other';
  role: string;
}

interface RegistrationRequest {
  userId: string;
  teamName: string;
  teamLeadPhone: string;
  teamLeadGender: 'Male' | 'Female' | 'Other';
  teamLeadRole: string;
  members: TeamMember[];
}

export async function POST(request: NextRequest) {
  try {
    const body: RegistrationRequest = await request.json();
    const {
      userId,
      teamName,
      teamLeadPhone,
      teamLeadGender,
      teamLeadRole,
      members
    } = body;

    // ==========================================
    // STEP 1: Validate Required Fields
    // ==========================================

    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required. Please log in again.' },
        { status: 401 }
      );
    }

    if (!teamName || teamName.trim() === '') {
      return NextResponse.json(
        { error: 'Team name is required' },
        { status: 400 }
      );
    }

    // Validate Team Lead Details
    if (!teamLeadPhone || teamLeadPhone.trim() === '') {
      return NextResponse.json({ error: 'Team Lead Phone is required' }, { status: 400 });
    }
    if (!teamLeadGender || !['Male', 'Female', 'Other'].includes(teamLeadGender)) {
      return NextResponse.json({ error: 'Team Lead Gender is invalid' }, { status: 400 });
    }
    if (!teamLeadRole || teamLeadRole.trim() === '') {
      return NextResponse.json({ error: 'Team Lead Role is required' }, { status: 400 });
    }

    if (!Array.isArray(members)) {
      return NextResponse.json(
        { error: 'Members data is invalid' },
        { status: 400 }
      );
    }

    // Maximum 5 members (excluding team leader)
    if (members.length > 5) {
      return NextResponse.json(
        { error: 'Maximum 5 team members allowed (excluding team leader)' },
        { status: 400 }
      );
    }

    // ==========================================
    // STEP 2: Validate Each Member's Data
    // ==========================================

    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const memberNum = i + 1;

      if (!member.fullName || member.fullName.trim() === '') {
        return NextResponse.json(
          { error: `Member ${memberNum}: Full name is required` },
          { status: 400 }
        );
      }

      if (!member.email || member.email.trim() === '') {
        return NextResponse.json(
          { error: `Member ${memberNum}: Email is required` },
          { status: 400 }
        );
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(member.email)) {
        return NextResponse.json(
          { error: `Member ${memberNum}: Invalid email format` },
          { status: 400 }
        );
      }

      if (!member.phone || member.phone.trim() === '') {
        return NextResponse.json(
          { error: `Member ${memberNum}: Phone number is required` },
          { status: 400 }
        );
      }

      if (!member.gender || !['Male', 'Female', 'Other'].includes(member.gender)) {
        return NextResponse.json(
          { error: `Member ${memberNum}: Valid gender is required (Male/Female/Other)` },
          { status: 400 }
        );
      }

      if (!member.role || member.role.trim() === '') {
        return NextResponse.json(
          { error: `Member ${memberNum}: Role is required` },
          { status: 400 }
        );
      }
    }

    // Check for duplicate emails within the team (including lead?)
    // Lead credentials are in 'team' doc, we'll check later or assume lead email is unique vs members
    const emails = members.map(m => m.email.toLowerCase());
    const uniqueEmails = new Set(emails);
    if (emails.length !== uniqueEmails.size) {
      return NextResponse.json(
        { error: 'Duplicate email addresses found in team members' },
        { status: 400 }
      );
    }

    // ==========================================
    // STEP 3: Find Team Document for This User
    // ==========================================

    // Team document is pre-created when campus lead invites team leads
    // We need to find it by the leader_user_id
    let teamsQuery;
    try {
      teamsQuery = await serverDatabases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.TEAMS,
        [Query.equal('leader_user_id', userId)]
      );
    } catch (error: any) {
      console.error('Error querying teams:', error);
      return NextResponse.json(
        { error: 'Database error. Please try again.' },
        { status: 500 }
      );
    }

    if (teamsQuery.total === 0) {
      return NextResponse.json(
        {
          error: 'No team found for your account. Please contact your campus lead to create your team first.'
        },
        { status: 404 }
      );
    }

    const team = teamsQuery.documents[0];

    // If somehow there are multiple teams for one user, log it but use the first one
    if (teamsQuery.total > 1) {
      console.warn(`Warning: User ${userId} has ${teamsQuery.total} teams. Using the first one.`);
    }

    // Check if lead email is in members list
    if (emails.includes(team.teamLeadEmail.toLowerCase())) {
      return NextResponse.json(
        { error: 'Team Lead email cannot be in the members list' },
        { status: 400 }
      );
    }

    // ==========================================
    // STEP 4: Update Team Document with Details
    // ==========================================

    let updatedTeam;
    try {
      updatedTeam = await serverDatabases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.TEAMS,
        team.$id,
        {
          // Core team info
          name: teamName.trim(),
          teamName: teamName.trim(),
          status: 'submitted', // Or keep as is? Request didn't specify changing status logic, but usually after registration it is submitted.
          membersCount: members.length + 1, // Include Lead

          // Note: $updatedAt is automatically managed by Appwrite
        }
      );
    } catch (error: any) {
      console.error('Error updating team:', error);
      return NextResponse.json(
        { error: 'Failed to update team information. Please try again.' },
        { status: 500 }
      );
    }

    // ==========================================
    // STEP 5: Manage Team Members
    // ==========================================

    // First, remove any existing members (in case of re-submission/update)
    try {
      const existingMembers = await serverDatabases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.MEMBERS,
        [Query.equal('team_id', team.$id)]
      );

      if (existingMembers.total > 0) {
        console.log(`Deleting ${existingMembers.total} existing members for team ${team.$id}`);
        await Promise.all(
          existingMembers.documents.map(doc =>
            serverDatabases.deleteDocument(DATABASE_ID, COLLECTIONS.MEMBERS, doc.$id)
              .catch(err => console.error(`Failed to delete member ${doc.$id}:`, err))
          )
        );
      }
    } catch (error) {
      console.error('Error managing existing members:', error);
      // Non-critical error, continue with member creation
    }

    // Create new member documents
    // Include Team Lead as a member
    const allMembersToCreate = [
      {
        fullName: team.teamLeadName,
        email: team.teamLeadEmail,
        phone: teamLeadPhone,
        gender: teamLeadGender,
        role: teamLeadRole
      },
      ...members
    ];

    const memberPromises = allMembersToCreate.map((member, index) => {
      return serverDatabases.createDocument(
        DATABASE_ID,
        COLLECTIONS.MEMBERS,
        ID.unique(),
        {
          team_id: team.$id,
          institution_id: team.institution_id,
          institution_name: team.institutionName || '',

          // Member details
          full_name: member.fullName.trim(),
          email: member.email.trim().toLowerCase(),
          phone: member.phone.trim(),
          gender: member.gender,
          role: member.role.trim()
        }
      ).catch(err => {
        console.error(`Failed to create member ${index + 1}:`, err);
        console.error('Member data:', member);
        console.error('Error details:', err.message, err.code);
        throw new Error(`Failed to add member: ${member.fullName}`);
      });
    });

    let newMembers;
    try {
      newMembers = await Promise.all(memberPromises);
    } catch (error: any) {
      console.error('Error creating members:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to add team members. Please try again.' },
        { status: 500 }
      );
    }

    // ==========================================
    // STEP 6: Update Institution Statistics
    // ==========================================

    // Update the count of registered teams for this institution
    try {
      const institutionTeams = await serverDatabases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.TEAMS,
        [
          Query.equal('institution_id', team.institution_id),
          Query.equal('status', 'registered')
        ]
      );

      await serverDatabases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.INSTITUTIONS,
        team.institution_id,
        {
          teamsRegistered: institutionTeams.total
        }
      );
    } catch (error) {
      console.error('Failed to update institution statistics:', error);
      // Non-critical error, don't fail the request
    }

    // ==========================================
    // STEP 7: Return Success Response
    // ==========================================

    return NextResponse.json({
      success: true,
      message: 'Team registered successfully!',
      data: {
        team: {
          id: updatedTeam.$id,
          name: updatedTeam.name,
          status: updatedTeam.status,
          membersCount: updatedTeam.membersCount,
          ideaTitle: updatedTeam.idea_title,
          institutionName: updatedTeam.institutionName
        },
        members: newMembers.map(m => ({
          id: m.$id,
          fullName: m.full_name,
          email: m.email,
          role: m.role
        }))
      }
    }, { status: 200 });

  } catch (error: any) {
    // Catch any unexpected errors
    console.error('Unexpected error in team registration:', error);
    return NextResponse.json(
      {
        error: 'An unexpected error occurred. Please try again or contact support.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      },
      { status: 500 }
    );
  }
}
