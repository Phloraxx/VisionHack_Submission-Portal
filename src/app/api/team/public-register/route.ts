/**
 * Public Team Registration API Route
 * 
 * Purpose: Allows anyone to register a team from the front page
 * 
 * Flow:
 * 1. Check if registration_open config is true
 * 2. Validate all team and member data
 * 3. Fetch institution details (including district)
 * 4. Create team lead user account with 'lead' role
 * 5. Create team document with status 'waitlisted'
 * 6. Create member documents for team lead + all members
 * 7. Update institution statistics
 * 8. Send email with login credentials to team lead
 * 
 * Request Body:
 * - institutionId: string (selected institution ID)
 * - teamName: string
 * - teamLeadName: string
 * - teamLeadEmail: string
 * - teamLeadPhone: string
 * - teamLeadGender: 'Male' | 'Female' | 'Other'
 * - teamLeadRole: string
 * - members: Array<{fullName, email, phone, gender, role}> (0-5 members, excluding lead)
 */

import { NextRequest, NextResponse } from 'next/server';
import { serverDatabases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite-server';
import { ID, Query } from 'node-appwrite';
import { createUserAccount } from '@/lib/auth-service';
import { sendEmail } from '@/lib/email-service';

interface TeamMember {
  fullName: string;
  email: string;
  phone: string;
  gender: 'Male' | 'Female' | 'Other';
  role: string;
}

interface PublicRegistrationRequest {
  institutionId: string;
  teamName: string;
  teamLeadName: string;
  teamLeadEmail: string;
  teamLeadPhone: string;
  teamLeadGender: 'Male' | 'Female' | 'Other';
  teamLeadRole: string;
  members: TeamMember[];
}

export async function POST(request: NextRequest) {
  try {
    const body: PublicRegistrationRequest = await request.json();
    const {
      institutionId,
      teamName,
      teamLeadName,
      teamLeadEmail,
      teamLeadPhone,
      teamLeadGender,
      teamLeadRole,
      members
    } = body;

    // ==========================================
    // STEP 1: Check if Registration is Open
    // ==========================================

    let configDoc;
    try {
      configDoc = await serverDatabases.getDocument(
        DATABASE_ID,
        COLLECTIONS.CONFIG,
        'registration_open'
      );
    } catch (error) {
      console.error('Error fetching config:', error);
      return NextResponse.json(
        { error: 'Unable to verify registration status. Please try again.' },
        { status: 500 }
      );
    }

    if (!configDoc.value_bool) {
      return NextResponse.json(
        { 
          error: 'Registration is currently closed',
          message: 'Team registration is not open at this time. Please check back later or contact the administrators.'
        },
        { status: 403 }
      );
    }

    // ==========================================
    // STEP 2: Validate Required Fields
    // ==========================================

    if (!institutionId || institutionId.trim() === '') {
      return NextResponse.json(
        { error: 'Please select an institution' },
        { status: 400 }
      );
    }

    if (!teamName || teamName.trim() === '') {
      return NextResponse.json(
        { error: 'Team name is required' },
        { status: 400 }
      );
    }

    // Validate Team Lead Details
    if (!teamLeadName || teamLeadName.trim() === '') {
      return NextResponse.json({ error: 'Team lead name is required' }, { status: 400 });
    }

    if (!teamLeadEmail || teamLeadEmail.trim() === '') {
      return NextResponse.json({ error: 'Team lead email is required' }, { status: 400 });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(teamLeadEmail)) {
      return NextResponse.json(
        { error: 'Invalid team lead email format' },
        { status: 400 }
      );
    }

    if (!teamLeadPhone || teamLeadPhone.trim() === '') {
      return NextResponse.json({ error: 'Team lead phone is required' }, { status: 400 });
    }

    if (!teamLeadGender || !['Male', 'Female', 'Other'].includes(teamLeadGender)) {
      return NextResponse.json({ error: 'Team lead gender is invalid' }, { status: 400 });
    }

    if (!teamLeadRole || teamLeadRole.trim() === '') {
      return NextResponse.json({ error: 'Team lead role is required' }, { status: 400 });
    }

    if (!Array.isArray(members)) {
      return NextResponse.json(
        { error: 'Members data is invalid' },
        { status: 400 }
      );
    }

    // Minimum 1 member (team lead alone), Maximum 6 members total (lead + 5 members)
    if (members.length > 5) {
      return NextResponse.json(
        { error: 'Maximum 5 team members allowed (excluding team leader)' },
        { status: 400 }
      );
    }

    // ==========================================
    // STEP 3: Validate Each Member's Data
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

    // Check for duplicate emails
    const allEmails = [teamLeadEmail.toLowerCase(), ...members.map(m => m.email.toLowerCase())];
    const uniqueEmails = new Set(allEmails);
    if (allEmails.length !== uniqueEmails.size) {
      return NextResponse.json(
        { error: 'Duplicate email addresses found in team' },
        { status: 400 }
      );
    }

    // ==========================================
    // STEP 4: Fetch Institution Details
    // ==========================================

    let institution;
    try {
      institution = await serverDatabases.getDocument(
        DATABASE_ID,
        COLLECTIONS.INSTITUTIONS,
        institutionId
      );
    } catch (error: any) {
      console.error('Error fetching institution:', error);
      return NextResponse.json(
        { error: 'Selected institution not found' },
        { status: 404 }
      );
    }

    if (institution.status !== 'active') {
      return NextResponse.json(
        { error: 'Selected institution is not accepting registrations' },
        { status: 400 }
      );
    }

    // ==========================================
    // STEP 5: Check for Existing User with Same Email
    // ==========================================

    // Check if team lead email already exists in teams
    let existingTeams;
    try {
      existingTeams = await serverDatabases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.TEAMS,
        [Query.equal('teamLeadEmail', teamLeadEmail.toLowerCase())]
      );
    } catch (error) {
      console.error('Error checking existing teams:', error);
    }

    if (existingTeams && existingTeams.total > 0) {
      return NextResponse.json(
        { error: 'A team with this email address already exists. Please use a different email or contact support.' },
        { status: 409 }
      );
    }

    // ==========================================
    // STEP 6: Create Team Lead User Account
    // ==========================================

    const userResult = await createUserAccount({
      email: teamLeadEmail.trim().toLowerCase(),
      name: teamLeadName.trim(),
      role: 'lead',
      institutionId: institutionId
    });

    if (!userResult.success) {
      console.error('Failed to create user account:', userResult.error);
      return NextResponse.json(
        { 
          error: 'Failed to create user account. The email might already be in use.',
          details: userResult.error
        },
        { status: 500 }
      );
    }

    // ==========================================
    // STEP 7: Generate Unique Team Code
    // ==========================================

    function generateTeamCode(): string {
      return Math.floor(1000 + Math.random() * 9000).toString();
    }

    let teamCode = generateTeamCode();
    let codeExists = true;
    let attempts = 0;

    // Ensure unique team code
    while (codeExists && attempts < 10) {
      try {
        const existing = await serverDatabases.listDocuments(
          DATABASE_ID,
          COLLECTIONS.TEAMS,
          [Query.equal('team_code', teamCode)]
        );
        codeExists = existing.total > 0;
        if (codeExists) {
          teamCode = generateTeamCode();
          attempts++;
        }
      } catch (error) {
        console.error('Error checking team code:', error);
        break;
      }
    }

    // ==========================================
    // STEP 8: Create Team Document
    // ==========================================

    let team;
    try {
      team = await serverDatabases.createDocument(
        DATABASE_ID,
        COLLECTIONS.TEAMS,
        ID.unique(),
        {
          name: teamName.trim(),
          teamName: teamName.trim(),
          leader_user_id: userResult.userId,
          institution_id: institutionId,
          status: 'waitlisted', // New teams start as waitlisted
          district: institution.district || '',
          
          // Legacy fields for compatibility
          institutionName: institution.name,
          teamLeadId: userResult.userId,
          teamLeadName: teamLeadName.trim(),
          teamLeadEmail: teamLeadEmail.trim().toLowerCase(),
          membersCount: members.length + 1, // Including lead
          createdAt: new Date().toISOString(),
          team_code: teamCode
        }
      );
    } catch (error: any) {
      console.error('Error creating team document:', error);
      return NextResponse.json(
        { error: 'Failed to create team. Please try again.' },
        { status: 500 }
      );
    }

    // ==========================================
    // STEP 9: Create Member Documents
    // ==========================================

    const allMembersToCreate = [
      {
        fullName: teamLeadName.trim(),
        email: teamLeadEmail.trim().toLowerCase(),
        phone: teamLeadPhone.trim(),
        gender: teamLeadGender,
        role: teamLeadRole.trim()
      },
      ...members
    ];

    const memberPromises = allMembersToCreate.map((member) => {
      return serverDatabases.createDocument(
        DATABASE_ID,
        COLLECTIONS.MEMBERS,
        ID.unique(),
        {
          team_id: team.$id,
          institution_id: institutionId,
          institution_name: institution.name,
          full_name: member.fullName.trim(),
          email: member.email.trim().toLowerCase(),
          phone: member.phone.trim(),
          gender: member.gender,
          role: member.role.trim()
        }
      ).catch(err => {
        console.error(`Failed to create member:`, err);
        throw new Error(`Failed to add member: ${member.fullName}`);
      });
    });

    try {
      await Promise.all(memberPromises);
    } catch (error: any) {
      console.error('Error creating members:', error);
      // Rollback: delete team document
      try {
        await serverDatabases.deleteDocument(DATABASE_ID, COLLECTIONS.TEAMS, team.$id);
      } catch (rollbackError) {
        console.error('Failed to rollback team creation:', rollbackError);
      }
      return NextResponse.json(
        { error: error.message || 'Failed to add team members. Please try again.' },
        { status: 500 }
      );
    }

    // ==========================================
    // STEP 10: Update Institution Statistics
    // ==========================================

    try {
      await serverDatabases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.INSTITUTIONS,
        institutionId,
        {
          teamsRegistered: (institution.teamsRegistered || 0) + 1
        }
      );
    } catch (error) {
      console.error('Failed to update institution statistics:', error);
      // Non-critical error, don't fail the request
    }

    // ==========================================
    // STEP 11: Send Email with Login Credentials
    // ==========================================

    try {
      await sendEmail({
        to: userResult.email,
        name: userResult.name,
        email: userResult.email,
        password: userResult.password,
        role: 'team_lead',
        institutionName: institution.name
      });
    } catch (error) {
      console.error('Failed to send email:', error);
      // Email failure shouldn't fail the registration
      // The user can still log in with their credentials
    }

    // ==========================================
    // STEP 12: Return Success Response
    // ==========================================

    return NextResponse.json({
      success: true,
      message: 'Team registered successfully! Login credentials have been sent to your email. Please check your inbox (and spam folder) to access your dashboard.',
      data: {
        team: {
          id: team.$id,
          name: team.name,
          status: team.status,
          teamCode: team.team_code,
          institutionName: institution.name,
          district: institution.district
        },
        credentials: {
          email: userResult.email,
          // Don't send password in response for security
          message: 'Login credentials have been sent to the team lead email address. Please check your inbox and spam folder.'
        }
      }
    }, { status: 201 });

  } catch (error: any) {
    console.error('Unexpected error in public team registration:', error);
    return NextResponse.json(
      {
        error: 'An unexpected error occurred. Please try again or contact support.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      },
      { status: 500 }
    );
  }
}
