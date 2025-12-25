// src/app/institution/dashboard/page.tsx - Institution Dashboard
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authHelpers, UserRole, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Users, CheckCircle, Lock, UserPlus, Mail, Trash2, ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Query } from 'appwrite';

interface TeamLead {
  name: string;
  email: string;
}

interface Team {
  $id: string;
  teamLeadName: string;
  teamLeadEmail: string;
  teamName: string;
  membersCount: number;
  status: string;
  createdAt: string;
  idea_title: string;
  idea_desc: string;
  idea_tech_stack: string;
  mentor_name: string;
  mentor_contact: string;
}

interface TeamMember {
  $id: string;
  full_name: string;
  email: string;
  phone: string;
  gender: string;
  role: string;
}

interface Institution {
  $id: string;
  name: string;
  campusLeadId: string;
  campusLeadName: string;
  campusLeadEmail: string;
  teamsRegistered: number;
  teamsShortlisted: number;
  maxTeams: number;
  status: string;
}

export default function InstitutionDashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [invitedTeams, setInvitedTeams] = useState<Team[]>([]);
  const [teamLeads, setTeamLeads] = useState<TeamLead[]>([{ name: '', email: '' }]);
  const [isInviting, setIsInviting] = useState(false);
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMember[]>>({});

  useEffect(() => {
    const checkAuth = async () => {
      const user = await authHelpers.getCurrentUser();
      if (!user) {
        router.push('/auth/login');
        return;
      }
      const role = authHelpers.getUserRole(user);
      if (!role || role !== UserRole.INSTITUTION) {
        router.push(role ? authHelpers.getRoleDashboard(role) : '/auth/login');
        return;
      }
      
      // Fetch institution data
      await fetchInstitutionData(user.$id);
      setIsLoading(false);
    };
    checkAuth();
  }, [router]);

  const fetchInstitutionData = async (userId: string) => {
    try {
      const response = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.INSTITUTIONS,
        [Query.equal('campusLeadId', userId)]
      );

      if (response.documents.length > 0) {
        const institutionData = response.documents[0] as any;
        setInstitution(institutionData);
        
        // Fetch invited teams for this institution
        await fetchInvitedTeams(institutionData.$id);
      } else {
        toast.error('No institution found. Please contact admin to create your institution account.');
      }
    } catch (error: any) {
      console.error('Error fetching institution:', error);
      toast.error('Failed to load institution data');
    }
  };

  const fetchInvitedTeams = async (institutionId: string) => {
    try {
      const response = await databases.listDocuments(
        DATABASE_ID,
        COLLECTIONS.TEAMS,
        [Query.equal('institution_id', institutionId)]
      );
      
      setInvitedTeams(response.documents as any[]);
    } catch (error: any) {
      console.error('Error fetching teams:', error);
    }
  };

  const addTeamLeadField = () => {
    const totalAfterAdd = (institution?.teamsShortlisted || 0) + teamLeads.length + 1;
    if (totalAfterAdd <= 5) {
      setTeamLeads([...teamLeads, { name: '', email: '' }]);
    } else {
      toast.error('Cannot add more team leads. Maximum limit is 5 total.');
    }
  };

  const removeTeamLeadField = (index: number) => {
    if (teamLeads.length > 1) {
      setTeamLeads(teamLeads.filter((_, i) => i !== index));
    }
  };

  const updateTeamLead = (index: number, field: 'name' | 'email', value: string) => {
    const updated = [...teamLeads];
    updated[index][field] = value;
    setTeamLeads(updated);
  };

  const toggleTeamExpansion = async (teamId: string) => {
    const newExpanded = new Set(expandedTeams);
    
    if (newExpanded.has(teamId)) {
      newExpanded.delete(teamId);
    } else {
      newExpanded.add(teamId);
      
      // Fetch members if not already loaded
      if (!teamMembers[teamId]) {
        try {
          const membersResponse = await databases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.MEMBERS,
            [Query.equal('team_id', teamId)]
          );
          
          setTeamMembers(prev => ({
            ...prev,
            [teamId]: membersResponse.documents as any[]
          }));
        } catch (error) {
          console.error('Error fetching team members:', error);
          toast.error('Failed to load team members');
        }
      }
    }
    
    setExpandedTeams(newExpanded);
  };

  const handleToggleApproval = async (teamId: string, teamName: string, currentStatus: string) => {
    const isCurrentlyApproved = currentStatus === 'registered';
    const action = isCurrentlyApproved ? 'unapprove' : 'approve';
    const newStatus = isCurrentlyApproved ? 'submitted' : 'registered';
    
    const message = isCurrentlyApproved 
      ? `Unapprove team "${teamName}"? This will allow them to edit their data again.`
      : `Approve team "${teamName}"? This will lock their data from further edits.`;
    
    if (!window.confirm(message)) {
      return;
    }

    try {
      await databases.updateDocument(
        DATABASE_ID,
        COLLECTIONS.TEAMS,
        teamId,
        { status: newStatus }
      );
      
      toast.success(isCurrentlyApproved ? 'Team unapproved. They can now edit their data.' : 'Team approved and locked!');
      
      // Refresh teams
      if (institution) {
        await fetchInvitedTeams(institution.$id);
      }
    } catch (error) {
      console.error('Error toggling approval:', error);
      toast.error('Failed to update team status');
    }
  };



  const handleInviteTeamLeads = async () => {
    // Validate input
    const validLeads = teamLeads.filter(lead => lead.name.trim() && lead.email.trim());
    
    if (validLeads.length === 0) {
      toast.error('Please add at least one team lead');
      return;
    }

    if (validLeads.length > 5) {
      toast.error('Maximum 5 team leads allowed');
      return;
    }

    if (!institution) {
      toast.error('Institution data not found');
      return;
    }

    // Check if campus lead has already invited teams
    const totalTeamsAfterInvite = (institution.teamsShortlisted || 0) + validLeads.length;
    if (totalTeamsAfterInvite > 5) {
      toast.error(`You can only invite ${5 - (institution.teamsShortlisted || 0)} more team lead(s). Maximum is 5 total.`);
      return;
    }

    setIsInviting(true);

    try {
      const response = await fetch('/api/institution/create-team-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          institutionId: institution.$id,
          teamLeads: validLeads,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Successfully invited ${data.accountsCreated} team leads!`);
        // Reset form
        setTeamLeads([{ name: '', email: '' }]);
        // Refresh institution data
        await fetchInstitutionData(institution.campusLeadId);
      } else {
        toast.error(data.error || 'Failed to invite team leads');
      }
    } catch (error: any) {
      console.error('Error inviting team leads:', error);
      toast.error('An error occurred while inviting team leads');
    } finally {
      setIsInviting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  const canInvite = institution && (institution.teamsShortlisted || 0) < 5;
  const remainingSlots = institution ? 5 - (institution.teamsShortlisted || 0) : 0;

  return (
    <div className="container mx-auto px-6 py-12">
      <FadeIn>
        <div className="space-y-2 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Campus Lead Dashboard</h1>
          <p className="text-gray-600">
            {institution?.campusLeadName || 'Campus Lead'} • {institution?.name || 'Your Institution'}
          </p>
          <p className="text-sm text-gray-500">
            {institution?.campusLeadEmail}
          </p>
        </div>
      </FadeIn>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <SlideIn delay={0.1}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-gray-600">Total Teams</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{institution?.teamsRegistered || 0}</p>
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-gray-600">Shortlisted</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">
                {institution?.teamsShortlisted || 0}/5
              </p>
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.3}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-gray-600">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold flex items-center gap-2">
                {canInvite ? (
                  <>
                    <CheckCircle className="h-6 w-6 text-green-600" />
                    <span className="text-green-600">Active</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-6 w-6 text-orange-600" />
                    <span className="text-orange-600">Full</span>
                  </>
                )}
              </p>
            </CardContent>
          </Card>
        </SlideIn>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <SlideIn delay={0.4}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Invite Team Leads
              </CardTitle>
              <CardDescription>
                Add the details of your shortlisted team leads (max 5 total)
                {remainingSlots > 0 && (
                  <span className="block mt-1 text-blue-600 font-medium">
                    {remainingSlots} slot{remainingSlots !== 1 ? 's' : ''} remaining
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {teamLeads.map((lead, index) => (
                <div key={index} className="p-4 border rounded-lg space-y-3 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold">Team Lead {(institution?.teamsShortlisted || 0) + index + 1}</Label>
                    {teamLeads.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTeamLeadField(index)}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor={`name-${index}`}>Full Name</Label>
                    <Input
                      id={`name-${index}`}
                      value={lead.name}
                      onChange={(e) => updateTeamLead(index, 'name', e.target.value)}
                      placeholder="Enter team lead name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`email-${index}`}>Email Address</Label>
                    <Input
                      id={`email-${index}`}
                      type="email"
                      value={lead.email}
                      onChange={(e) => updateTeamLead(index, 'email', e.target.value)}
                      placeholder="Enter email address"
                    />
                  </div>
                </div>
              ))}

              {((institution?.teamsShortlisted || 0) + teamLeads.length) < 5 && (
                <Button
                  variant="outline"
                  onClick={addTeamLeadField}
                  className="w-full"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Another Team Lead ({remainingSlots - teamLeads.length} remaining)
                </Button>
              )}

              <Button
                onClick={handleInviteTeamLeads}
                disabled={isInviting || !canInvite}
                className="w-full"
              >
                {isInviting ? (
                  <>Sending invitations...</>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Invite Team Leads
                  </>
                )}
              </Button>

              {!canInvite && institution && institution.teamsShortlisted >= 5 && (
                <p className="text-sm text-orange-600 text-center">
                  You have reached the maximum limit of 5 team leads
                </p>
              )}
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.5}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                How It Works
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-600">
                    1
                  </div>
                  <div>
                    <h4 className="font-semibold">Add Team Lead Details</h4>
                    <p className="text-sm text-gray-600">
                      Enter the name and email of each shortlisted team lead
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-600">
                    2
                  </div>
                  <div>
                    <h4 className="font-semibold">Accounts Created Automatically</h4>
                    <p className="text-sm text-gray-600">
                      System creates accounts with secure auto-generated passwords
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-600">
                    3
                  </div>
                  <div>
                    <h4 className="font-semibold">Email Sent with Credentials</h4>
                    <p className="text-sm text-gray-600">
                      Each team lead receives their login details via email
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-600">
                    4
                  </div>
                  <div>
                    <h4 className="font-semibold">Team Leads Access Portal</h4>
                    <p className="text-sm text-gray-600">
                      They can log in and register their teams for the hackathon
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> You can invite up to 5 team leads. Make sure the email addresses are correct as credentials will be sent automatically.
                </p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      </div>

      {invitedTeams.length > 0 && (
        <SlideIn delay={0.6}>
          <Card className="border-gray-100 mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Invited Team Leads ({invitedTeams.length})
              </CardTitle>
              <CardDescription>
                Team leads you have invited to participate
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {invitedTeams.map((team, index) => {
                  const isExpanded = expandedTeams.has(team.$id);
                  const members = teamMembers[team.$id] || [];
                  
                  return (
                    <div key={team.$id} className="border rounded-lg bg-white hover:shadow-md transition-all">
                      <div 
                        className="p-4 cursor-pointer"
                        onClick={() => toggleTeamExpansion(team.$id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-semibold text-lg">{index + 1}.</span>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-semibold text-lg">{team.teamLeadName}</h4>
                                  {team.status === 'registered' && (
                                    <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                                      ✓ Approved
                                    </span>
                                  )}
                                  {team.status === 'submitted' && team.teamName && (
                                    <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded-full font-medium">
                                      ⏳ Pending Review
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-600">{team.teamLeadEmail}</p>
                              </div>
                            </div>
                            {team.teamName && (
                              <div className="mt-2">
                                <p className="text-sm">
                                  <strong className="text-gray-700">Team:</strong> <span className="text-gray-900">{team.teamName}</span>
                                </p>
                              </div>
                            )}
                            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                              <span>Members: {team.membersCount || 0}</span>
                              {team.createdAt && (
                                <span>Invited: {new Date(team.createdAt).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                          <div className="ml-4">
                            {isExpanded ? (
                              <ChevronUp className="h-5 w-5 text-gray-400" />
                            ) : (
                              <ChevronDown className="h-5 w-5 text-gray-400" />
                            )}
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-4 border-t bg-gray-50">
                          {/* Team Details */}
                          <div className="pt-4 space-y-3">
                            <h5 className="font-semibold text-gray-900">Team Details</h5>
                            
                            {team.idea_title && (
                              <div>
                                <p className="text-xs text-gray-500 uppercase font-medium">Idea Title</p>
                                <p className="text-sm text-gray-900">{team.idea_title}</p>
                              </div>
                            )}
                            
                            {team.idea_desc && (
                              <div>
                                <p className="text-xs text-gray-500 uppercase font-medium">Description</p>
                                <p className="text-sm text-gray-700">{team.idea_desc}</p>
                              </div>
                            )}
                            
                            {team.idea_tech_stack && (
                              <div>
                                <p className="text-xs text-gray-500 uppercase font-medium">Tech Stack</p>
                                <p className="text-sm text-gray-700">{team.idea_tech_stack}</p>
                              </div>
                            )}
                            
                            {team.mentor_name && (
                              <div>
                                <p className="text-xs text-gray-500 uppercase font-medium">Faculty Mentor</p>
                                <p className="text-sm text-gray-900">{team.mentor_name}</p>
                                {team.mentor_contact && (
                                  <p className="text-sm text-gray-600">{team.mentor_contact}</p>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Team Members */}
                          {members.length > 0 && (
                            <div className="pt-2">
                              <h5 className="font-semibold text-gray-900 mb-3">Team Members ({members.length})</h5>
                              <div className="space-y-2">
                                {members.map((member, idx) => (
                                  <div key={member.$id} className="p-3 bg-white rounded border">
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <p className="font-medium text-gray-900">
                                          {idx + 1}. {member.full_name}
                                        </p>
                                        <p className="text-sm text-gray-600">{member.email}</p>
                                        <div className="flex gap-4 mt-1 text-sm text-gray-500">
                                          <span>{member.phone}</span>
                                          <span>{member.gender}</span>
                                          <span className="text-blue-600 font-medium">{member.role}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Approval Toggle */}
                          {team.teamName && (
                            <div className="pt-2">
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleApproval(team.$id, team.teamName, team.status);
                                }}
                                className={team.status === 'registered' 
                                  ? "w-full bg-orange-600 hover:bg-orange-700" 
                                  : "w-full bg-green-600 hover:bg-green-700"
                                }
                              >
                                {team.status === 'registered' ? (
                                  <>
                                    <X className="h-4 w-4 mr-2" />
                                    Unapprove (Allow Edits)
                                  </>
                                ) : (
                                  <>
                                    <Check className="h-4 w-4 mr-2" />
                                    Approve & Lock
                                  </>
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      )}
    </div>
  );
}