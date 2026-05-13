// Team Details Page for Coordinator
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authHelpers, UserRole } from '@/lib/appwrite';
import { ArrowLeft, Building2, Users, Mail, Phone, User, Lightbulb, Code, Award, Calendar, ExternalLink, Download } from 'lucide-react';
import { toast } from 'sonner';

interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  gender: string;
  role: string;
}

interface Institution {
  id: string;
  name: string;
  code: string;
  campusLeadName: string;
  campusLeadEmail: string;
}

interface TeamDetails {
  id: string;
  teamName: string;
  ideaTitle: string;
  ideaDesc: string;
  techStack: string;
  status: string;
  teamLeadEmail: string;
  teamLeadName: string;
  leaderUserId: string;
  createdAt: string;
  updatedAt: string;
  mentorName: string;
  mentorContact: string;
  submissionFileId: string;
  institution: Institution | null;
  institutionName: string;
  members: TeamMember[];
  membersCount: number;
  teamCode: string;
  questionnaire?: any;
}

export default function TeamDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.teamId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [team, setTeam] = useState<TeamDetails | null>(null);
  const [showAllResources, setShowAllResources] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const user = await authHelpers.getCurrentUser();
      if (!user) {
        router.push('/auth/login');
        return;
      }
      const role = authHelpers.getUserRole(user);
      if (!role || role !== UserRole.COORDINATOR) {
        router.push(role ? authHelpers.getRoleDashboard(role) : '/auth/login');
        return;
      }
      setIsLoading(false);

      // Fetch team details
      await fetchTeamDetails();
    };
    checkAuth();
  }, [router, teamId]);

  const fetchTeamDetails = async () => {
    setIsFetching(true);
    try {
      const response = await fetch(`/api/coordinator/teams/${teamId}`);
      const data = await response.json();

      if (data.success) {
        setTeam(data.team);
      } else {
        toast.error(data.error || 'Failed to fetch team details');
      }
    } catch (error: any) {
      console.error('Error fetching team details:', error);
      toast.error('Failed to load team details');
    } finally {
      setIsFetching(false);
    }
  };

  const handleDownloadCSV = () => {
    if (!team) return;

    // Helper to escape CSV fields
    const escapeCsv = (str: string | null | undefined) => {
      if (!str) return '';
      const stringValue = String(str);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    // Flatten questionnaire data
    const q = team.questionnaire || {};
    const questionnaireData = {
      'Profile ID': q.profile_id,
      'Age Group': q.age_group,
      'Gender': q.gender,
      'Education': q.education_level,
      'Current Activity': q.current_activity,
      'Other Activity': q.activity_other,
      'Activity Duration': q.activity_duration,
      'Primary Income': q.is_primary_income ? 'Yes' : 'No',
      'Monthly Income': q.monthly_income,
      'Resources Needed': q.resources_needed?.map((r: string) => r.replace(/^\$+/, '')).join('; '),
      'Skills to Improve': q.skills_to_improve?.join('; '),
      'Challenges': q.challenges,
      'Sales Channels': q.sales_channels?.join('; '),
      'Selling Difficulty': q.selling_difficulty ? 'Yes' : 'No',
      'Selling Difficulty Details': q.selling_difficulty_details,
      'Support Needed': q.support_needed?.join('; '),
      'Growth Plans': q.growth_plans?.join('; ')
    };

    // Flatten Members
    const membersData: Record<string, string> = {};
    team.members.forEach((m, i) => {
      const idx = i + 1;
      membersData[`Member ${idx} Name`] = m.fullName;
      membersData[`Member ${idx} Email`] = m.email;
      membersData[`Member ${idx} Phone`] = m.phone;
      membersData[`Member ${idx} Role`] = m.role;
    });

    // Combine all data
    const rowData = {
      'Team Name': team.teamName,
      'Team Code': team.teamCode,
      'Status': team.status,
      'Idea Title': team.ideaTitle,
      'Idea Description': team.ideaDesc,
      'Tech Stack': team.techStack,
      'Submitted At': team.createdAt,
      'Institution Name': team.institutionName,
      'Institution Code': team.institution?.code,
      'Campus Lead Name': team.institution?.campusLeadName,
      'Campus Lead Email': team.institution?.campusLeadEmail,
      'Team Lead Name': team.teamLeadName,
      'Team Lead Email': team.teamLeadEmail,
      'Mentor Name': team.mentorName,
      'Mentor Contact': team.mentorContact,
      ...questionnaireData,
      ...membersData
    };

    // Generate CSV content
    const headers = Object.keys(rowData);
    const values = Object.values(rowData).map(escapeCsv);
    const csvContent = [
      headers.join(','),
      values.join(',')
    ].join('\n');

    // Trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${team.teamName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_details.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading || isFetching) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
          <p className="text-gray-600 mt-4">Loading team details...</p>
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Team not found</p>
          <Button onClick={() => router.push('/coordinator/dashboard')} className="mt-4">
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <FadeIn>
        <div className="flex justify-between items-center mb-6">
          <Button
            variant="ghost"
            onClick={() => router.push('/coordinator/dashboard')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>

          <Button
            variant="outline"
            onClick={handleDownloadCSV}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
        </div>
      </FadeIn>

      <FadeIn>
        <div className="space-y-2 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{team.teamName}</h1>
          <div className="flex items-center gap-4 text-gray-600">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <span>{team.institutionName}</span>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-medium ${team.status === 'idea_submitted' || team.status === 'submitted' ? 'bg-purple-100 text-purple-800' :
                team.status === 'shortlisted' ? 'bg-green-100 text-green-800' :
                  team.status === 'questionnaire_submitted' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
              }`}>
              {team.status === 'idea_submitted' ? 'Idea Submitted' :
                team.status === 'questionnaire_submitted' ? 'Questionnaire Submitted' :
                  team.status.charAt(0).toUpperCase() + team.status.slice(1)}
            </div>
          </div>
        </div>
      </FadeIn>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Team Information */}
        <SlideIn delay={0.1}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5" />
                Team Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">Idea Title</h4>
                    <p className="text-gray-900 font-medium">{team.ideaTitle}</p>
                  </div>
                  {team.submissionFileId && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-blue-600 border-blue-200 hover:bg-blue-50"
                      onClick={() => {
                        const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
                        const fileUrl = `${endpoint}/storage/buckets/${process.env.NEXT_PUBLIC_APPWRITE_SUBMISSIONS_BUCKET_ID}/files/${team.submissionFileId}/view?project=${process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID}`;
                        window.open(fileUrl, '_blank');
                      }}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Submission
                    </Button>
                  )}
                </div>
                {team.teamCode && (
                  <div className="mt-2">
                    <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded">
                      Team Code: {team.teamCode}
                    </span>
                  </div>
                )}
              </div>

              {team.ideaDesc && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-1">Description</h4>
                  <p className="text-gray-600 text-sm leading-relaxed">{team.ideaDesc}</p>
                </div>
              )}

              {team.techStack && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
                    <Code className="h-4 w-4" />
                    Tech Stack
                  </h4>
                  <p className="text-gray-600 text-sm">{team.techStack}</p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Submitted On
                </h4>
                <p className="text-gray-600 text-sm">
                  {new Date(team.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>

        {/* Institution & Lead Information */}
        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Institution & Team Lead
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {team.institution && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Institution</h4>
                  <div className="space-y-1">
                    <p className="text-gray-900">{team.institution.name}</p>
                    <p className="text-xs text-gray-500">Code: {team.institution.code}</p>
                  </div>
                </div>
              )}

              {team.institution && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Campus Lead</h4>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-gray-500" />
                      <span>{team.institution.campusLeadName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-gray-500" />
                      <span>{team.institution.campusLeadEmail}</span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Team Lead</h4>
                <div className="space-y-1">
                  {team.teamLeadName && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-gray-500" />
                      <span>{team.teamLeadName}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-gray-500" />
                    <span>{team.teamLeadEmail}</span>
                  </div>
                </div>
              </div>

              {(team.mentorName || team.mentorContact) && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <Award className="h-4 w-4" />
                    Mentor
                  </h4>
                  <div className="space-y-1">
                    {team.mentorName && (
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 text-gray-500" />
                        <span>{team.mentorName}</span>
                      </div>
                    )}
                    {team.mentorContact && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-gray-500" />
                        <span>{team.mentorContact}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </SlideIn>
      </div>

      {/* Team Members */}
      <SlideIn delay={0.3}>

        <Card className="border-gray-100 mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team Members ({team.membersCount})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {team.members.length === 0 ? (
              <p className="text-gray-600 text-sm">No members registered</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {team.members.map((member, index) => (
                  <div
                    key={member.id}
                    className="border border-gray-100 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <h4 className="font-semibold text-gray-900">{member.fullName}</h4>
                      <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                        Member {index + 1}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Mail className="h-4 w-4" />
                        <span className="break-all">{member.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Phone className="h-4 w-4" />
                        <span>{member.phone}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <User className="h-4 w-4" />
                        <span>{member.gender}</span>
                      </div>
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <span className="text-xs font-medium text-gray-700">Role:</span>
                        <span className="text-xs text-gray-600 ml-2">{member.role}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </SlideIn>

      {/* Questionnaire Responses */}
      <SlideIn delay={0.4}>
        <Card className="border-gray-100 mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              Questionnaire Response
            </CardTitle>
          </CardHeader>
          <CardContent>
            {team.questionnaire ? (
              <div className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">Profile & Demographics</h4>
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between border-b pb-1">
                        <dt className="text-gray-600">Profile ID</dt>
                        <dd className="font-medium">{team.questionnaire.profile_id}</dd>
                      </div>
                      <div className="flex justify-between border-b pb-1">
                        <dt className="text-gray-600">Age</dt>
                        <dd className="font-medium">{team.questionnaire.age_group}</dd>
                      </div>
                      <div className="flex justify-between border-b pb-1">
                        <dt className="text-gray-600">Gender</dt>
                        <dd className="font-medium">{team.questionnaire.gender}</dd>
                      </div>
                      <div className="flex justify-between border-b pb-1">
                        <dt className="text-gray-600">Education</dt>
                        <dd className="font-medium">{team.questionnaire.education_level}</dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">Activity & Income</h4>
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between border-b pb-1">
                        <dt className="text-gray-600">Current Activity</dt>
                        <dd className="font-medium text-right">{team.questionnaire.current_activity}</dd>
                      </div>
                      {team.questionnaire.activity_other && (
                        <div className="flex justify-between border-b pb-1">
                          <dt className="text-gray-600">Other Activity</dt>
                          <dd className="font-medium text-right">{team.questionnaire.activity_other}</dd>
                        </div>
                      )}
                      <div className="flex justify-between border-b pb-1">
                        <dt className="text-gray-600">Duration</dt>
                        <dd className="font-medium">{team.questionnaire.activity_duration}</dd>
                      </div>
                      <div className="flex justify-between border-b pb-1">
                        <dt className="text-gray-600">Primary Income?</dt>
                        <dd className="font-medium">{team.questionnaire.is_primary_income ? 'Yes' : 'No'}</dd>
                      </div>
                      <div className="flex justify-between border-b pb-1">
                        <dt className="text-gray-600">Monthly Income</dt>
                        <dd className="font-medium">{team.questionnaire.monthly_income}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6 pt-4 border-t">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">Resources Needed</h4>
                    <div className="space-y-1">
                      {team.questionnaire.resources_needed && team.questionnaire.resources_needed.length > 0 ? (
                        (() => {
                          const priority: Record<string, number> = { 'High': 3, 'Medium': 2, 'Low': 1 };

                          const processedResources = team.questionnaire.resources_needed
                            .map((res: string) => {
                              const [key, val] = res.split(':');
                              // Remove all leading $ signs
                              const cleanKey = key.replace(/^\$+/, '');
                              const cleanVal = val.replace(/^\$+/, '');
                              return { key: cleanKey, val: cleanVal, priority: priority[cleanVal] || 0 };
                            })
                            .sort((a: any, b: any) => b.priority - a.priority);

                          const displayResources = showAllResources ? processedResources : processedResources.slice(0, 4);
                          const hasMore = processedResources.length > 4;

                          return (
                            <>
                              {displayResources.map((item: any, idx: number) => (
                                <div key={idx} className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                                  <span className="text-gray-600">{item.key}</span>
                                  <span className={`font-medium ${item.val === 'High' ? 'text-red-600' :
                                    item.val === 'Medium' ? 'text-yellow-600' :
                                      item.val === 'Low' ? 'text-green-600' : 'text-gray-600'
                                    }`}>{item.val}</span>
                                </div>
                              ))}

                              {hasMore && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setShowAllResources(!showAllResources)}
                                  className="w-full mt-2 text-xs text-blue-600 hover:text-blue-800 h-auto py-1"
                                >
                                  {showAllResources ? "Show Less" : `View ${processedResources.length - 4} More`}
                                </Button>
                              )}
                            </>
                          );
                        })()
                      ) : (
                        <p className="text-sm text-gray-500">None specified</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">Skills to Improve</h4>
                    {team.questionnaire.skills_to_improve && team.questionnaire.skills_to_improve.length > 0 ? (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {team.questionnaire.skills_to_improve.map((skill: string, idx: number) => (
                          <span key={idx} className="bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded border border-blue-100">
                            {skill}
                          </span>
                        ))}
                      </div>
                    ) : <p className="text-sm text-gray-500">None selected</p>}

                    {team.questionnaire.challenges && (
                      <div className="mt-4">
                        <h4 className="font-semibold text-gray-900 mb-1">Challenges</h4>
                        <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded">{team.questionnaire.challenges}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6 pt-4 border-t">
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">Sales Info</h4>
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between border-b pb-1">
                        <dt className="text-gray-600">Sales Channels</dt>
                        <dd className="font-medium text-right text-xs max-w-[50%]">
                          {team.questionnaire.sales_channels?.join(', ') || 'None'}
                        </dd>
                      </div>
                      <div className="flex justify-between border-b pb-1">
                        <dt className="text-gray-600">Facing Difficulty?</dt>
                        <dd className="font-medium">{team.questionnaire.selling_difficulty ? 'Yes' : 'No'}</dd>
                      </div>
                      {team.questionnaire.selling_difficulty && (
                        <div className="mt-2">
                          <dt className="text-gray-600 mb-1">Difficulties:</dt>
                          <dd className="text-gray-800 bg-red-50 p-2 rounded text-xs">{team.questionnaire.selling_difficulty_details}</dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">Support & Growth</h4>
                    <dl className="space-y-2 text-sm">
                      <div className="mb-2">
                        <dt className="text-gray-600 mb-1">Support Needed:</dt>
                        <dd className="flex flex-wrap gap-1">
                          {team.questionnaire.support_needed?.map((s: string, i: number) => (
                            <span key={i} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-100">{s}</span>
                          )) || 'None'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-600 mb-1">Growth Plans:</dt>
                        <dd className="flex flex-wrap gap-1">
                          {team.questionnaire.growth_plans?.map((s: string, i: number) => (
                            <span key={i} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-100">{s}</span>
                          )) || 'None'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>

              </div>
            ) : (
              <div className="text-center py-8">
                <Code className="h-12 w-12 text-gray-200 mx-auto mb-2" />
                <p className="text-gray-500">No questionnaire response submitted yet.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </SlideIn>
    </div>
  );
}
